import type { Database } from './db.js';
import type { SourceFile } from './files.js';

// Keep individual PostgreSQL fields and protocol messages small, including a 1 GiB file.
const CHUNK_BYTES = 4 * 1024 * 1024;

export async function readFiles(db: Database, id: string, path?: string): Promise<SourceFile[]> {
  const { rows } = await db.query<{ path: string; content: Buffer; byte_size: number | null }>(
    `SELECT path, content, byte_size FROM files WHERE source_id=$1${path === undefined ? '' : ' AND path=$2'} ORDER BY path`,
    path === undefined ? [id] : [id, path],
  );
  const files: SourceFile[] = [];
  for (const file of rows) {
    if (file.byte_size === null) {
      files.push({ path: file.path, content: Buffer.from(file.content) });
    } else {
      const chunks = await db.query<{ content: Buffer }>(
        'SELECT content FROM file_chunks WHERE source_id=$1 AND path=$2 ORDER BY ordinal',
        [id, file.path],
      );
      const content = Buffer.concat(chunks.rows.map((chunk) => chunk.content));
      if (content.length !== file.byte_size) throw new Error('Incomplete file storage');
      files.push({ path: file.path, content });
    }
  }
  return files;
}

export async function storeFile(db: Database, id: string, file: SourceFile) {
  const chunked = file.content.length > CHUNK_BYTES;
  await db.query('INSERT INTO files (source_id,path,content,byte_size) VALUES ($1,$2,$3,$4)', [
    id,
    file.path,
    chunked ? Buffer.alloc(0) : file.content,
    chunked ? file.content.length : null,
  ]);
  if (chunked)
    for (let offset = 0; offset < file.content.length; offset += CHUNK_BYTES)
      await db.query(
        'INSERT INTO file_chunks (source_id,path,ordinal,content) VALUES ($1,$2,$3,$4)',
        [id, file.path, offset / CHUNK_BYTES, file.content.subarray(offset, offset + CHUNK_BYTES)],
      );
}
