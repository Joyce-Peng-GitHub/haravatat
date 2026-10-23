import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { HttpError } from './errors.js';
import { validateFiles, virtualPath, type SourceFile } from './files.js';
import { boundedBody } from './repository.js';
export const MAX_PDF_BYTES = 32 * 1024 * 1024;
export interface Compiler {
  compile(files: SourceFile[], entry: string): Promise<Buffer>;
}
export function remoteCompiler(url: string): Compiler {
  return {
    async compile(files, entry) {
      validateFiles(files);
      virtualPath(entry);
      const boundary = `haravatat-${randomUUID()}`;
      async function* body() {
        for (const file of files) {
          yield Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${encodeURIComponent(file.path)}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          );
          for (let offset = 0; offset < file.content.length; offset += 64 * 1024)
            yield file.content.subarray(offset, offset + 64 * 1024);
          yield Buffer.from('\r\n');
        }
        yield Buffer.from(`--${boundary}--\r\n`);
      }
      const init: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'X-Typst-Entry': encodeURIComponent(entry),
        },
        body: Readable.toWeb(Readable.from(body())) as ReadableStream<Uint8Array>,
        duplex: 'half',
        signal: AbortSignal.timeout(300_000),
        redirect: 'error',
      };
      const response = await fetch(new URL('/compile', url), init).catch(() => {
        throw new HttpError(502, '编译服务不可用或超时');
      });
      if (!response.ok) {
        const text = (await boundedBody(response, 32_768)).toString('utf8');
        throw new HttpError(422, `Typst 编译失败：${text}`);
      }
      const pdf = await boundedBody(response, MAX_PDF_BYTES);
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
        throw new HttpError(502, '编译服务未返回 PDF');
      return pdf;
    },
  };
}
export const nativeCompiler: Compiler = {
  async compile(files, entry) {
    validateFiles(files);
    virtualPath(entry);
    if (!files.some((f) => f.path === entry)) throw new HttpError(400, '编译入口不存在');
    const directory = await mkdtemp(join(tmpdir(), 'haravatat-'));
    const root = join(directory, 'source'),
      output = join(directory, 'article.pdf');
    try {
      await mkdir(root);
      for (const file of files) {
        const destination = join(root, file.path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { flag: 'wx' });
      }
      const binary = process.env.TYPST_BIN || 'typst';
      const args = [
        'compile',
        '--root',
        root,
        '--package-path',
        join(directory, 'packages'),
        '--package-cache-path',
        process.env.TYPST_PACKAGE_CACHE || join(directory, 'cache'),
        '--font-path',
        root,
        '--jobs',
        '1',
        '--diagnostic-format',
        'short',
        join(root, entry),
        output,
      ];
      try {
        await promisify(execFile)(
          'prlimit',
          [
            '--as=4294967296',
            '--cpu=25',
            `--fsize=${MAX_PDF_BYTES}`,
            '--nofile=128',
            '--',
            binary,
            ...args,
          ],
          {
            timeout: 30_000,
            killSignal: 'SIGKILL',
            maxBuffer: 32_768,
            env: {
              PATH: process.env.PATH,
              HOME: directory,
              XDG_CACHE_HOME: join(directory, 'cache'),
              LANG: 'C.UTF-8',
            },
            cwd: root,
          },
        );
      } catch (error) {
        const diagnostic =
          error && typeof error === 'object' && 'stderr' in error
            ? String(error.stderr).replaceAll(directory, '[workspace]').slice(0, 24_000)
            : '';
        throw new HttpError(422, diagnostic || '编译超时、资源超过限制或编译器未安装');
      }
      if ((await stat(output)).size > MAX_PDF_BYTES) throw new HttpError(413, '编译结果过大');
      return await readFile(output);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
};
