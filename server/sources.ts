import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import type { Database } from './db.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import {
  virtualPath,
  validateFiles,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_SOURCE_BYTES,
  type SourceFile,
} from './files.js';
import { publicRepositories, repositoryName, type RepositoryClient } from './repository.js';
export interface Source {
  id: string;
  user_id: string;
  name: string;
  kind: 'upload' | 'github';
  repository: string | null;
  branch: string | null;
  revision: number;
  commit_sha: string | null;
}
export const sourceId = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export async function ownedSource(
  db: Database,
  id: string,
  userId: string,
  lock = false,
): Promise<Source> {
  const result = await db.query<Source>(
    `SELECT * FROM sources WHERE id=$1 AND user_id=$2${lock ? ' FOR UPDATE' : ''}`,
    [id, userId],
  );
  if (!result.rows[0]) throw new HttpError(404, '未找到工作区');
  return result.rows[0];
}
export async function sourceFiles(db: Database, id: string) {
  const { rows } = await db.query<{ path: string; content: Buffer }>(
    'SELECT path, content FROM files WHERE source_id=$1 ORDER BY path',
    [id],
  );
  return rows.map((file) => ({ path: file.path, content: Buffer.from(file.content) }));
}
async function writeFiles(tx: Database, id: string, files: SourceFile[]) {
  validateFiles(files);
  await tx.query('DELETE FROM files WHERE source_id=$1', [id]);
  for (const file of files)
    await tx.query('INSERT INTO files VALUES ($1,$2,$3)', [id, file.path, file.content]);
  await tx.query('UPDATE sources SET revision=revision+1 WHERE id=$1', [id]);
}
export async function sourceRoutes(
  app: FastifyInstance,
  db: Database,
  repositories: RepositoryClient = publicRepositories,
) {
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 0, parts: MAX_FILES },
  });
  app.get('/api/sources', async (request) => {
    const user = await requireUser(db, request);
    return {
      sources: (
        await db.query(
          'SELECT s.*, (SELECT count(*)::int FROM files f WHERE f.source_id=s.id) AS file_count, (SELECT count(*)::int FROM posts p WHERE p.source_id=s.id) AS post_count FROM sources s WHERE user_id=$1 ORDER BY created_at DESC',
          [user.id],
        )
      ).rows,
    };
  });
  app.post('/api/sources', async (request, reply) => {
    const user = await requireUser(db, request);
    const body = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('upload'), name: z.string().trim().min(1).max(120) }),
        z.object({
          kind: z.literal('github'),
          name: z.string().trim().min(1).max(120),
          repository: z.string().max(300),
          branch: z.string().trim().min(1).max(200),
        }),
      ])
      .parse(request.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      if ((await tx.query('SELECT id FROM sources WHERE user_id=$1', [user.id])).rows.length >= 20)
        throw new HttpError(413, '每个用户最多 20 个工作区');
      await tx.query(
        'INSERT INTO sources (id,user_id,name,kind,repository,branch) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          id,
          user.id,
          body.name,
          body.kind,
          body.kind === 'github' ? repositoryName(body.repository) : null,
          body.kind === 'github' ? body.branch : null,
        ],
      );
    });
    reply.status(201);
    return { source: await ownedSource(db, id, user.id) };
  });
  app.get('/api/sources/:id', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const source = await ownedSource(db, id, user.id);
    const files = (
      await db.query(
        'SELECT f.path, octet_length(f.content) AS size, p.id AS post_id, p.title, p.source_revision FROM files f LEFT JOIN posts p ON p.source_id=f.source_id AND p.entry_path=f.path WHERE f.source_id=$1 ORDER BY f.path',
        [id],
      )
    ).rows;
    const posts = (
      await db.query(
        'SELECT id, entry_path, title, source_revision FROM posts WHERE source_id=$1 ORDER BY entry_path',
        [id],
      )
    ).rows;
    return { source, files, posts };
  });
  app.delete('/api/sources/:id', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    await ownedSource(db, id, user.id);
    await db.query('DELETE FROM sources WHERE id=$1 AND user_id=$2', [id, user.id]);
    return { ok: true };
  });
  app.get('/api/sources/:id/file', async (request, reply) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    await ownedSource(db, id, user.id);
    const path = virtualPath(z.object({ path: z.string() }).parse(request.query).path);
    const { rows } = await db.query<{ content: Buffer }>(
      'SELECT content FROM files WHERE source_id=$1 AND path=$2',
      [id, path],
    );
    if (!rows[0]) throw new HttpError(404, '未找到文件');
    return reply
      .type('application/octet-stream')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1)!)}`,
      )
      .send(Buffer.from(rows[0].content));
  });
  const changeFiles = async (
    id: string,
    userId: string,
    mutate: (files: SourceFile[]) => SourceFile[],
  ) =>
    db.transaction(async (tx) => {
      const source = await ownedSource(tx, id, userId, true);
      if (source.kind !== 'upload') throw new HttpError(409, '仓库来源请在 GitHub 修改后同步');
      await writeFiles(tx, id, mutate(await sourceFiles(tx, id)));
    });
  app.post('/api/sources/:id/upload', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const source = await ownedSource(db, id, user.id);
    if (source.kind !== 'upload') throw new HttpError(409, '仓库来源不能上传文件');
    const additions: SourceFile[] = [];
    let size = 0;
    for await (const part of request.files()) {
      const path = virtualPath(decodeURIComponent(part.filename));
      const content = await part.toBuffer();
      size += content.length;
      if (size > MAX_SOURCE_BYTES) throw new HttpError(413, '上传总大小不能超过 50 MiB');
      additions.push({ path, content });
    }
    if (!additions.length) throw new HttpError(400, '请选择上传文件');
    validateFiles(additions);
    const added = new Set(additions.map((f) => f.path));
    await changeFiles(id, user.id, (files) => [
      ...files.filter((f) => !added.has(f.path)),
      ...additions,
    ]);
    return { ok: true };
  });
  app.put('/api/sources/:id/file', { bodyLimit: MAX_FILE_BYTES + 1024 }, async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const body = z.object({ path: z.string(), content: z.string() }).parse(request.body);
    const path = virtualPath(body.path);
    await changeFiles(id, user.id, (files) => [
      ...files.filter((f) => f.path !== path),
      { path, content: Buffer.from(body.content) },
    ]);
    return { ok: true };
  });
  app.delete('/api/sources/:id/file', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const { path: raw } = z.object({ path: z.string() }).parse(request.query);
    const path = virtualPath(raw);
    await changeFiles(id, user.id, (files) => {
      const next = files.filter((f) => f.path !== path && !f.path.startsWith(`${path}/`));
      if (next.length === files.length) throw new HttpError(404, '未找到文件或目录');
      return next;
    });
    return { ok: true };
  });
  app.post('/api/sources/:id/move', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const body = z.object({ from: z.string(), to: z.string() }).parse(request.body);
    const from = virtualPath(body.from),
      to = virtualPath(body.to);
    await changeFiles(id, user.id, (files) => {
      const moving = files.filter((f) => f.path === from || f.path.startsWith(`${from}/`));
      if (!moving.length) throw new HttpError(404, '未找到文件或目录');
      const next = files.filter((f) => !moving.includes(f));
      return [...next, ...moving.map((f) => ({ ...f, path: to + f.path.slice(from.length) }))];
    });
    return { ok: true };
  });
  app.post(
    '/api/sources/:id/sync',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await requireUser(db, request),
        id = sourceId(request.params);
      const source = await ownedSource(db, id, user.id);
      if (source.kind !== 'github') throw new HttpError(409, '这个工作区不来自 GitHub');
      const snapshot = await repositories.snapshot(source.repository!, source.branch!);
      await db.transaction(async (tx) => {
        const current = await ownedSource(tx, id, user.id, true);
        if (current.revision !== source.revision) throw new HttpError(409, '工作区已更新，请重试');
        await writeFiles(tx, id, snapshot.files);
        await tx.query('UPDATE sources SET commit_sha=$2,synced_at=now() WHERE id=$1', [
          id,
          snapshot.commit,
        ]);
      });
      return { ok: true, commit: snapshot.commit };
    },
  );
}
