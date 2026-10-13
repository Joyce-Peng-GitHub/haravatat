import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from './db.js';
import { requireUser } from './auth.js';
import { HttpError } from './errors.js';
import { entryFormat, virtualPath } from './files.js';
import { ownedSource, sourceId, sourceFiles } from './sources.js';
import { renderMarkdown, type Asset } from './markdown.js';
import type { Compiler } from './compile.js';
export function postRoutes(app: FastifyInstance, db: Database, compiler: Compiler) {
  app.post(
    '/api/sources/:id/publish',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await requireUser(db, request),
        id = sourceId(request.params);
      const { entries } = z
        .object({
          entries: z
            .array(
              z.object({ path: z.string(), title: z.string().trim().min(1).max(200).optional() }),
            )
            .max(30),
        })
        .parse(request.body);
      const paths = entries.map((e) => virtualPath(e.path));
      if (new Set(paths).size !== paths.length) throw new HttpError(400, '发布入口不能重复');
      const snapshot = await db.transaction(async (tx) => {
        const source = await ownedSource(tx, id, user.id, true);
        return {
          source,
          files: await sourceFiles(tx, id),
          existing: (
            await tx.query<{ id: string; entry_path: string }>(
              'SELECT id,entry_path FROM posts WHERE source_id=$1',
              [id],
            )
          ).rows,
        };
      });
      const postIds = new Map(
        entries.map((e) => [
          e.path,
          snapshot.existing.find((p) => p.entry_path === e.path)?.id ?? randomUUID(),
        ]),
      );
      const builds: {
        id: string;
        path: string;
        title: string;
        format: string;
        content: Buffer;
        assets: Asset[];
      }[] = [];
      for (const entry of entries) {
        const format = entryFormat(entry.path);
        if (!format || !snapshot.files.some((f) => f.path === entry.path))
          throw new HttpError(400, `入口不是有效的 Typst / Markdown 文件：${entry.path}`);
        const postId = postIds.get(entry.path)!;
        if (format === 'typst') {
          builds.push({
            id: postId,
            path: entry.path,
            title: entry.title ?? posix.basename(entry.path, posix.extname(entry.path)),
            format,
            content: await compiler.compile(snapshot.files, entry.path),
            assets: [],
          });
        } else {
          const rendered = renderMarkdown(snapshot.files, entry.path, postId, postIds);
          builds.push({
            id: postId,
            path: entry.path,
            title: entry.title ?? rendered.title,
            format,
            content: rendered.content,
            assets: rendered.assets,
          });
        }
      }
      await db.transaction(async (tx) => {
        const current = await ownedSource(tx, id, user.id, true);
        if (current.revision !== snapshot.source.revision)
          throw new HttpError(409, '编译期间文件已发生变化，请重新发布');
        // Publishing itself advances the revision, so concurrent publishes cannot overwrite one another.
        await tx.query('UPDATE sources SET revision=revision+1 WHERE id=$1', [id]);
        await tx.query(
          'DELETE FROM posts WHERE source_id=$1 AND NOT (entry_path=ANY($2::text[]))',
          [id, paths],
        );
        for (const build of builds) {
          await tx.query(
            'INSERT INTO posts (id,source_id,entry_path,title,format,content,source_revision) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (source_id,entry_path) DO UPDATE SET title=excluded.title,format=excluded.format,content=excluded.content,source_revision=excluded.source_revision,updated_at=now()',
            [
              build.id,
              id,
              build.path,
              build.title,
              build.format,
              build.content,
              current.revision + 1,
            ],
          );
          await tx.query('DELETE FROM post_assets WHERE post_id=$1', [build.id]);
          for (const asset of build.assets)
            await tx.query('INSERT INTO post_assets VALUES ($1,$2,$3,$4)', [
              build.id,
              asset.path,
              asset.content,
              asset.media_type,
            ]);
        }
      });
      return { posts: builds.map((b) => ({ id: b.id, title: b.title, path: b.path })) };
    },
  );
  app.get('/api/posts', async (request) => {
    const { page, author } = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        author: z.string().max(100).optional(),
      })
      .parse(request.query);
    const params = [author ?? null, (page - 1) * 24];
    const { rows } = await db.query(
      'SELECT p.id,p.title,p.format,p.published_at,p.updated_at,u.login,u.name,u.avatar_url,s.name AS source_name FROM posts p JOIN sources s ON s.id=p.source_id JOIN users u ON u.id=s.user_id WHERE ($1::text IS NULL OR lower(u.login)=lower($1)) ORDER BY p.published_at DESC,p.id LIMIT 25 OFFSET $2',
      params,
    );
    return { posts: rows.slice(0, 24), hasMore: rows.length > 24 };
  });
  app.get('/api/posts/:id', async (request) => {
    const id = sourceId(request.params);
    const { rows } = await db.query<{ id: string; format: string; content: Buffer }>(
      'SELECT p.*,u.login,u.name,u.avatar_url,s.name AS source_name FROM posts p JOIN sources s ON s.id=p.source_id JOIN users u ON u.id=s.user_id WHERE p.id=$1',
      [id],
    );
    if (!rows[0]) throw new HttpError(404, '文章不存在或已取消发布');
    const { content, ...post } = rows[0];
    return {
      post: {
        ...post,
        markdown: post.format === 'markdown' ? Buffer.from(content).toString('utf8') : undefined,
      },
    };
  });
  app.get('/api/posts/:id/pdf', async (request, reply) => {
    const { rows } = await db.query<{ content: Buffer }>(
      "SELECT content FROM posts WHERE id=$1 AND format='typst'",
      [sourceId(request.params)],
    );
    if (!rows[0]) throw new HttpError(404, 'PDF 不存在');
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'inline; filename="article.pdf"')
      .send(Buffer.from(rows[0].content));
  });
  app.get('/api/posts/:id/assets/:path', async (request, reply) => {
    const { id, path } = z.object({ id: z.uuid(), path: z.string() }).parse(request.params);
    const { rows } = await db.query<{ content: Buffer; media_type: string }>(
      'SELECT content,media_type FROM post_assets WHERE post_id=$1 AND path=$2',
      [id, path],
    );
    if (!rows[0]) throw new HttpError(404, '文章图片不存在');
    return reply.type(rows[0].media_type).send(Buffer.from(rows[0].content));
  });
}
