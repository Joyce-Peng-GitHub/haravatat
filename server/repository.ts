import yauzl from 'yauzl';
import { z } from 'zod';
import { HttpError } from './errors.js';
import {
  MAX_FILE_BYTES,
  MAX_SOURCE_BYTES,
  MAX_FILES,
  validateFiles,
  type SourceFile,
} from './files.js';
export interface RepositorySnapshot {
  files: SourceFile[];
  commit: string;
}
export interface RepositoryClient {
  snapshot(repository: string, branch: string): Promise<RepositorySnapshot>;
}
export function repositoryName(value: string) {
  const name = value
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name) ||
    name.split('/').some((p) => p === '.' || p === '..')
  )
    throw new HttpError(400, '请填写 owner/repository 或 GitHub 仓库地址');
  return name;
}
export async function boundedBody(response: Response, max: number) {
  if (!response.body) throw new HttpError(502, '下载内容为空');
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new HttpError(413, '下载内容超过大小限制');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
export function extractRepository(buffer: Buffer): Promise<SourceFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new HttpError(400, '仓库压缩文件无效'));
      const files: SourceFile[] = [];
      let total = 0,
        entries = 0,
        root: string | undefined;
      const fail = (error: unknown) => {
        zip.close();
        reject(error);
      };
      zip.on('error', () => fail(new HttpError(400, '仓库压缩文件读取失败')));
      zip.on('end', () => {
        try {
          validateFiles(files);
          resolve(files);
        } catch (error) {
          fail(error);
        }
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          if (++entries > MAX_FILES * 3) throw new HttpError(413, '仓库包含过多条目');
          const parts = entry.fileName.split('/');
          root ??= parts[0];
          if (parts[0] !== root || parts.length < 2) throw new HttpError(400, '仓库目录结构无效');
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode === 0xa000 || (mode !== 0 && mode !== 0x8000 && mode !== 0x4000))
            throw new HttpError(400, '仓库不允许符号链接或特殊文件');
          if (entry.fileName.endsWith('/')) {
            zip.readEntry();
            return;
          }
          if (
            entry.uncompressedSize > MAX_FILE_BYTES ||
            total + entry.uncompressedSize > MAX_SOURCE_BYTES ||
            files.length >= MAX_FILES
          )
            throw new HttpError(413, '仓库超过工作区限制');
          total += entry.uncompressedSize;
          const path = parts.slice(1).join('/');
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail(new HttpError(400, '无法读取仓库文件'));
            const chunks: Buffer[] = [];
            let actual = 0;
            stream.on('data', (chunk: Buffer) => {
              actual += chunk.length;
              if (actual > MAX_FILE_BYTES || actual > entry.uncompressedSize) {
                stream.destroy();
                fail(new HttpError(413, '解压文件超过限制'));
              } else chunks.push(chunk);
            });
            stream.on('error', () => fail(new HttpError(400, '无法解压仓库文件')));
            stream.on('end', () => {
              files.push({ path, content: Buffer.concat(chunks) });
              zip.readEntry();
            });
          });
        } catch (error) {
          fail(error);
        }
      });
      zip.readEntry();
    });
  });
}
export const publicRepositories: RepositoryClient = {
  async snapshot(repository, branch) {
    const name = repositoryName(repository);
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'haravatat',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const request = async (url: string) => {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new HttpError(
          502,
          response.status === 404
            ? '未找到公开仓库或分支'
            : 'GitHub 下载失败或请求额度已用尽，请稍后重试',
        );
      return response;
    };
    const commitResponse = await request(
      `https://api.github.com/repos/${name}/commits/${encodeURIComponent(branch)}`,
    );
    const commit = z
      .object({ sha: z.string().regex(/^[0-9a-f]{40}$/) })
      .parse(await commitResponse.json()).sha;
    const archive = await request(`https://codeload.github.com/${name}/zip/${commit}`);
    const files = await extractRepository(await boundedBody(archive, MAX_SOURCE_BYTES));
    return { files, commit };
  },
};
