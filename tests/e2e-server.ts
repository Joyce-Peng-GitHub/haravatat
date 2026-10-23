import { randomUUID } from 'node:crypto';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { testDatabase } from './database.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { nativeCompiler } from '../server/compile.js';
import { readFile } from 'node:fs/promises';
const { db, close } = await testDatabase();
const apiPort = Number(process.env.E2E_API_PORT || 3000);
const source = randomUUID();
await db.query(
  "INSERT INTO users VALUES (101,'writer','知识的旅人','https://avatars.githubusercontent.com/u/101')",
);
await db.query("INSERT INTO sources (id,user_id,name,kind) VALUES ($1,101,'数学与日常','upload')", [
  source,
]);
const demoFiles = [
  { path: 'hello.md', content: Buffer.from(await readFile('examples/hello.md', 'utf8')) },
  { path: 'essay.typ', content: Buffer.from(await readFile('examples/essay.typ', 'utf8')) },
];
for (const file of demoFiles)
  await db.query('INSERT INTO files VALUES ($1,$2,$3)', [source, file.path, file.content]);
const pdf = await nativeCompiler.compile(demoFiles, 'essay.typ');
await db.query(
  "INSERT INTO posts (id,source_id,entry_path,title,format,content,source_revision) VALUES ($1,$2,'hello.md','文字、公式与慢思考','markdown',$3,0),($4,$2,'essay.typ','关于知识的边界','typst',$5,0)",
  [randomUUID(), source, demoFiles[0].content, randomUUID(), pdf],
);
const app = await createApp({
  db,
  config: loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused',
    APP_ORIGIN:
      process.env.E2E_PRODUCTION === '1' ? `http://127.0.0.1:${apiPort}` : 'http://127.0.0.1:5173',
    GITHUB_CLIENT_ID: 'test',
    GITHUB_CLIENT_SECRET: 'test',
  }),
  github: {
    async exchange() {
      return {
        id: 101,
        login: 'writer',
        name: '知识的旅人',
        avatar_url: 'https://avatars.githubusercontent.com/u/101',
      };
    },
  },
  compiler: nativeCompiler,
  repositories: {
    async snapshot(_repository, _branch, _token, _username, commit) {
      return {
        commit: commit || 'b'.repeat(40),
        files: [
          {
            path: 'remote.md',
            content: Buffer.from(`# 仓库中的文章\n\n${commit ? '固定 Commit' : '分支快照'}`),
          },
        ],
      };
    },
  },
});
if (process.env.E2E_PRODUCTION === '1') {
  await app.register(staticFiles, { root: resolve('dist'), wildcard: false });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/') || request.url.startsWith('/auth/')
      ? reply.status(404).send({ error: 'not found' })
      : reply.sendFile('index.html'),
  );
}
await app.listen({ host: '127.0.0.1', port: apiPort });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
