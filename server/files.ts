import { posix } from 'node:path';
import { HttpError } from './errors.js';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 1000;
export interface SourceFile {
  path: string;
  content: Buffer;
}
export function virtualPath(path: string): string {
  if (
    !path ||
    path.length > 500 ||
    path.startsWith('/') ||
    /[\\\x00-\x1f\x7f]/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..' || p === '.git') ||
    path.includes(':')
  )
    throw new HttpError(400, '文件路径必须是工作区内的相对路径，不能包含 .. 或 .git');
  return path;
}
export function validateFiles(files: SourceFile[]) {
  if (files.length > MAX_FILES) throw new HttpError(413, '每个工作区最多 1000 个文件');
  let bytes = 0;
  const paths = new Set<string>();
  for (const file of files) {
    virtualPath(file.path);
    if (paths.has(file.path)) throw new HttpError(400, '文件路径重复');
    paths.add(file.path);
    if (file.content.length > MAX_FILE_BYTES) throw new HttpError(413, '单文件不能超过 8 MiB');
    bytes += file.content.length;
  }
  if (bytes > MAX_SOURCE_BYTES) throw new HttpError(413, '工作区不能超过 50 MiB');
  for (const path of paths) {
    let parent = posix.dirname(path);
    while (parent !== '.') {
      if (paths.has(parent)) throw new HttpError(409, '同一个路径不能同时作为文件和目录');
      parent = posix.dirname(parent);
    }
  }
}
export function entryFormat(path: string): 'typst' | 'markdown' | null {
  if (/\.typ$/i.test(path)) return 'typst';
  if (/\.(md|markdown)$/i.test(path)) return 'markdown';
  return null;
}
