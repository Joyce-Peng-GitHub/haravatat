import type { Database } from './db.js';
import { HttpError } from './errors.js';
import { virtualPath } from './files.js';

// Explicit records keep empty folders; ancestors of files also support older workspaces.
export function directoryPaths(files: string[], stored: string[] = []): string[] {
  const directories = new Set<string>();
  const add = (path: string) => {
    const parts = path.split('/');
    for (let count = 1; count <= parts.length; count++)
      directories.add(parts.slice(0, count).join('/'));
  };
  for (const path of stored) add(path);
  for (const path of files) {
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent) add(parent);
  }
  return [...directories].sort();
}
export function validateDirectories(files: string[], directories: string[]) {
  for (const path of files) virtualPath(path);
  const filePaths = new Set(files);
  for (const path of directoryPaths(files, directories)) {
    virtualPath(path);
    if (filePaths.has(path)) throw new HttpError(409, '同一个路径不能同时作为文件和目录');
  }
}
export async function readDirectories(db: Database, id: string, files: string[]) {
  const { rows } = await db.query<{ path: string }>(
    'SELECT path FROM directories WHERE source_id=$1',
    [id],
  );
  return directoryPaths(
    files,
    rows.map((row) => row.path),
  );
}
export async function storeDirectories(db: Database, id: string, directories: string[]) {
  await db.query('DELETE FROM directories WHERE source_id=$1', [id]);
  if (directories.length)
    await db.query('INSERT INTO directories (source_id,path) SELECT $1,unnest($2::text[])', [
      id,
      directories,
    ]);
}
export const within = (path: string, parent: string) =>
  path === parent || path.startsWith(`${parent}/`);
