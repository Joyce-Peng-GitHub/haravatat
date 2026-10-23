import { posix } from 'node:path';
import { HttpError } from './errors.js';
import { MAX_SOURCE_BYTES, MAX_FILES } from '../shared/limits.js';
import { validWorkspacePath } from '../shared/paths.js';
export { MAX_SOURCE_BYTES, MAX_FILES };
export interface SourceFile {
  path: string;
  content: Buffer;
}
export function virtualPath(path: string): string {
  if (!validWorkspacePath(path))
    throw new HttpError(400, '文件路径必须是工作区内的相对路径，不能包含 ..、空分段或非法字符');
  return path;
}
export function validateFiles(files: SourceFile[]) {
  if (files.length > MAX_FILES) throw new HttpError(413, '每个工作区最多 1024 个文件');
  let bytes = 0;
  const paths = new Set<string>();
  for (const file of files) {
    virtualPath(file.path);
    if (paths.has(file.path)) throw new HttpError(400, '文件路径重复');
    paths.add(file.path);
    bytes += file.content.length;
  }
  if (bytes > MAX_SOURCE_BYTES) throw new HttpError(413, '工作区总大小不能超过 1 GiB');
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
