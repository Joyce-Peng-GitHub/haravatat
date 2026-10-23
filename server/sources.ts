import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import type { Database } from './db.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import { virtualPath, validateFiles, MAX_SOURCE_BYTES, type SourceFile } from './files.js';
import {
  gitRepositories,
  repositoryUrl,
  repositoryBranch,
  repositoryCommit,
  type RepositoryClient,
} from './repository.js';
import { readUpload, uploadLimits } from './uploads.js';
import { readFiles, storeFile } from './storage.js';
import {
  directoryPaths,
  readDirectories,
  storeDirectories,
  validateDirectories,
  within,
} from './directories.js';
import { credentialStore } from './credentials.js';
const tokenSchema = z
  .string()
  .max(1024)
  .regex(/^[^\x00-\x1f\x7f]*$/);
const usernameSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^[^:\x00-\x1f\x7f]*$/);
const credentialFlag =
  'EXISTS (SELECT 1 FROM repository_credentials c WHERE c.source_id=s.id) AS has_credentials';
export interface Source {
  id: string;
  user_id: string;
  name: string;
  kind: 'upload' | 'github' | 'git';
  repository: string | null;
  branch: string | null;
  revision: number;
  commit_sha: string | null;
  target_commit: string | null;
  auto_sync: boolean;
  has_credentials: boolean;
  synced_at: string | null;
}
export const sourceId = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export async function ownedSource(
  db: Database,
  id: string,
  userId: string,
  lock = false,
): Promise<Source> {
  const result = await db.query<Source>(
    `SELECT s.*, ${credentialFlag} FROM sources s WHERE s.id=$1 AND s.user_id=$2${lock ? ' FOR UPDATE OF s' : ''}`,
    [id, userId],
  );
  if (!result.rows[0]) throw new HttpError(404, '未找到工作区');
  return result.rows[0];
}
export async function sourceFiles(db: Database, id: string) {
  return readFiles(db, id);
}
async function writeFiles(tx: Database, id: string, files: SourceFile[]) {
  validateFiles(files);
  await tx.query('DELETE FROM files WHERE source_id=$1', [id]);
  for (const file of files) await storeFile(tx, id, file);
  await tx.query('UPDATE sources SET revision=revision+1 WHERE id=$1', [id]);
}
export async function sourceRoutes(
  app: FastifyInstance,
  db: Database,
  repositories: RepositoryClient = gitRepositories,
  encryptionKey?: string,
) {
  const credentials = credentialStore(db, encryptionKey);
  await app.register(multipart, {
    limits: uploadLimits,
  });
  app.get('/api/sources', async (request) => {
    const user = await requireUser(db, request);
    return {
      sources: (
        await db.query(
          `SELECT s.*, ${credentialFlag}, (SELECT count(*)::int FROM files f WHERE f.source_id=s.id) AS file_count, (SELECT count(*)::int FROM posts p WHERE p.source_id=s.id) AS post_count FROM sources s WHERE user_id=$1 ORDER BY created_at DESC`,
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
          kind: z.enum(['github', 'git']),
          name: z.string().trim().min(1).max(120),
          repository: z.string().max(2048),
          branch: z.string().trim().min(1).max(200).default('main'),
          commit: z.string().trim().max(64).optional(),
        }),
      ])
      .parse(request.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      if ((await tx.query('SELECT id FROM sources WHERE user_id=$1', [user.id])).rows.length >= 20)
        throw new HttpError(413, '每个用户最多 20 个工作区');
      await tx.query(
        'INSERT INTO sources (id,user_id,name,kind,repository,branch,target_commit) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          user.id,
          body.name,
          body.kind,
          body.kind !== 'upload' ? repositoryUrl(body.repository) : null,
          body.kind !== 'upload' ? repositoryBranch(body.branch) : null,
          body.kind !== 'upload' && body.commit ? repositoryCommit(body.commit) : null,
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
        'SELECT f.path, COALESCE(f.byte_size, octet_length(f.content)) AS size, p.id AS post_id, p.title, p.source_revision FROM files f LEFT JOIN posts p ON p.source_id=f.source_id AND p.entry_path=f.path WHERE f.source_id=$1 ORDER BY f.path',
        [id],
      )
    ).rows;
    const posts = (
      await db.query(
        'SELECT id, entry_path, title, source_revision FROM posts WHERE source_id=$1 ORDER BY entry_path',
        [id],
      )
    ).rows;
    return {
      source,
      files,
      directories: await readDirectories(
        db,
        id,
        files.map((file) => file.path as string),
      ),
      posts,
      credentialStorageAvailable: credentials.available,
    };
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
    const [file] = await db.transaction(async (tx) => {
      await ownedSource(tx, id, user.id, true);
      return readFiles(tx, id, path);
    });
    if (!file) throw new HttpError(404, '未找到文件');
    return reply
      .type('application/octet-stream')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1)!)}`,
      )
      .send(file.content);
  });
  const changeFiles = async (
    id: string,
    userId: string,
    mutate: (files: SourceFile[]) => SourceFile[],
  ) =>
    db.transaction(async (tx) => {
      const source = await ownedSource(tx, id, userId, true);
      if (source.kind !== 'upload') throw new HttpError(409, '仓库来源请在远端修改后同步');
      const files = await sourceFiles(tx, id);
      const directories = await readDirectories(
        tx,
        id,
        files.map((file) => file.path),
      );
      const next = mutate(files);
      const nextDirectories = directoryPaths(
        next.map((file) => file.path),
        directories,
      );
      validateDirectories(
        next.map((file) => file.path),
        nextDirectories,
      );
      await writeFiles(tx, id, next);
      await storeDirectories(tx, id, nextDirectories);
    });
  app.post('/api/sources/:id/upload', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const source = await ownedSource(db, id, user.id);
    if (source.kind !== 'upload') throw new HttpError(409, '仓库来源不能上传文件');
    const additions = await readUpload(request);
    if (!additions.length) throw new HttpError(400, '请选择上传文件');
    const added = new Set(additions.map((f) => f.path));
    await changeFiles(id, user.id, (files) => [
      ...files.filter((f) => !added.has(f.path)),
      ...additions,
    ]);
    return { ok: true };
  });
  app.put('/api/sources/:id/file', { bodyLimit: MAX_SOURCE_BYTES * 6 + 4096 }, async (request) => {
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
  // Folder operations only change metadata; large file chunks stay inside PostgreSQL.
  const changePaths = async (
    id: string,
    userId: string,
    mutate: (
      tx: Database,
      files: string[],
      directories: string[],
    ) => Promise<{ files: string[]; directories: string[] }>,
  ) =>
    db.transaction(async (tx) => {
      const source = await ownedSource(tx, id, userId, true);
      if (source.kind !== 'upload') throw new HttpError(409, '仓库来源请在远端修改后同步');
      const { rows } = await tx.query<{ path: string }>(
        'SELECT path FROM files WHERE source_id=$1',
        [id],
      );
      const files = rows.map((file) => file.path);
      const next = await mutate(tx, files, await readDirectories(tx, id, files));
      const directories = directoryPaths(next.files, next.directories);
      validateDirectories(next.files, directories);
      await storeDirectories(tx, id, directories);
      await tx.query('UPDATE sources SET revision=revision+1 WHERE id=$1', [id]);
    });
  app.post('/api/sources/:id/directory', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const path = virtualPath(z.object({ path: z.string() }).parse(request.body).path);
    await changePaths(id, user.id, async (_tx, files, directories) => {
      if (files.includes(path) || directories.includes(path))
        throw new HttpError(409, '目标路径已存在');
      return { files, directories: [...directories, path] };
    });
    return { ok: true };
  });
  app.delete('/api/sources/:id/file', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const path = virtualPath(z.object({ path: z.string() }).parse(request.query).path);
    await changePaths(id, user.id, async (tx, files, directories) => {
      if (!files.includes(path) && !directories.includes(path))
        throw new HttpError(404, '未找到文件或目录');
      const deleted = files.filter((file) => within(file, path));
      await tx.query('DELETE FROM files WHERE source_id=$1 AND path=ANY($2::text[])', [
        id,
        deleted,
      ]);
      return {
        files: files.filter((file) => !within(file, path)),
        directories: directories.filter((directory) => !within(directory, path)),
      };
    });
    return { ok: true };
  });
  app.post('/api/sources/:id/move', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const body = z.object({ from: z.string(), to: z.string() }).parse(request.body);
    const from = virtualPath(body.from),
      to = virtualPath(body.to);
    await changePaths(id, user.id, async (tx, files, directories) => {
      if (!files.includes(from) && !directories.includes(from))
        throw new HttpError(404, '未找到文件或目录');
      if (from === to) return { files, directories };
      if (directories.includes(from) && within(to, from))
        throw new HttpError(409, '不能将文件夹移动到自身内部');
      if (files.includes(to) || directories.includes(to))
        throw new HttpError(409, '目标路径已存在');
      const renamed = (path: string) => (within(path, from) ? to + path.slice(from.length) : path);
      const next = { files: files.map(renamed), directories: directories.map(renamed) };
      validateDirectories(next.files, next.directories);
      const moving = files.filter((file) => within(file, from));
      for (const path of moving) {
        const target = renamed(path);
        await tx.query(
          'INSERT INTO files (source_id,path,content,byte_size) SELECT source_id,$3,content,byte_size FROM files WHERE source_id=$1 AND path=$2',
          [id, path, target],
        );
        await tx.query(
          'INSERT INTO file_chunks (source_id,path,ordinal,content) SELECT source_id,$3,ordinal,content FROM file_chunks WHERE source_id=$1 AND path=$2',
          [id, path, target],
        );
      }
      await tx.query('DELETE FROM files WHERE source_id=$1 AND path=ANY($2::text[])', [id, moving]);
      return next;
    });
    return { ok: true };
  });
  app.put('/api/sources/:id/credentials', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const body = z
      .object({ token: tokenSchema.min(1), username: usernameSchema.optional() })
      .parse(request.body);
    await db.transaction(async (tx) => {
      const source = await ownedSource(tx, id, user.id, true);
      if (source.kind === 'upload') throw new HttpError(409, '这个工作区不是 Git 仓库');
      await credentialStore(tx, encryptionKey).save(source, body);
    });
    return { ok: true };
  });
  app.delete('/api/sources/:id/credentials', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    await db.transaction(async (tx) => {
      const source = await ownedSource(tx, id, user.id, true);
      if (source.kind === 'upload') throw new HttpError(409, '这个工作区不是 Git 仓库');
      await credentialStore(tx, encryptionKey).remove(id);
      await tx.query('UPDATE sources SET auto_sync=false WHERE id=$1', [id]);
    });
    return { ok: true };
  });
  app.patch('/api/sources/:id/settings', async (request) => {
    const user = await requireUser(db, request),
      id = sourceId(request.params);
    const body = z.object({ autoSync: z.boolean() }).parse(request.body);
    await db.transaction(async (tx) => {
      const source = await ownedSource(tx, id, user.id, true);
      if (source.kind === 'upload') throw new HttpError(409, '这个工作区不是 Git 仓库');
      await tx.query('UPDATE sources SET auto_sync=$2 WHERE id=$1', [id, body.autoSync]);
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
      if (source.kind === 'upload') throw new HttpError(409, '这个工作区不是 Git 仓库');
      const { token, username, commit, automatic } = z
        .object({
          commit: z.string().trim().max(64).optional(),
          username: usernameSchema.optional(),
          token: tokenSchema.optional(),
          automatic: z.boolean().default(false),
        })
        .parse(request.body ?? {});
      if (automatic && !source.auto_sync) return { ok: true, skipped: true };
      const saved = token === undefined ? await credentials.read(source) : undefined;
      const targetCommit =
        commit === undefined ? source.target_commit : commit ? repositoryCommit(commit) : null;
      const snapshot = await repositories.snapshot(
        source.repository!,
        source.branch!,
        token === undefined ? saved?.token : token || undefined,
        username === undefined ? saved?.username : username || undefined,
        targetCommit || undefined,
      );
      const unchanged =
        source.commit_sha === snapshot.commit && source.target_commit === targetCommit;
      await db.transaction(async (tx) => {
        const current = await ownedSource(tx, id, user.id, true);
        if (current.revision !== source.revision || current.target_commit !== source.target_commit)
          throw new HttpError(409, '工作区已更新，请重试');
        if (!unchanged) await writeFiles(tx, id, snapshot.files);
        await tx.query(
          'UPDATE sources SET commit_sha=$2,target_commit=$3,synced_at=now() WHERE id=$1',
          [id, snapshot.commit, targetCommit],
        );
      });
      return { ok: true, commit: snapshot.commit, unchanged };
    },
  );
}
