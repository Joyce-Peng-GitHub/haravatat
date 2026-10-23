import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase, migrate } from './db.js';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const config = loadConfig();
const db = connectDatabase(config.DATABASE_URL);
await migrate(db);
const app = await createApp({ db, config });
const dist = resolve('dist');
if (existsSync(dist)) {
  await app.register(staticFiles, { root: dist, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/auth/')
    )
      return reply.sendFile('index.html');
    return reply.status(404).send({ error: '未找到页面' });
  });
}
await app.listen({ port: config.PORT, host: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
