import { execFile } from 'node:child_process';
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
      const response = await fetch(new URL('/compile', url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry,
          files: files.map((f) => ({ path: f.path, content: f.content.toString('base64') })),
        }),
        signal: AbortSignal.timeout(45_000),
        redirect: 'error',
      }).catch(() => {
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
            '--as=1073741824',
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
