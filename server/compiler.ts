import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { nativeCompiler } from './compile.js';
import { HttpError } from './errors.js';
import { virtualPath } from './files.js';
import { readUpload, uploadLimits } from './uploads.js';
export async function createCompilerApp() {
  const app = Fastify({
    logger: false,
    requestTimeout: 300_000,
  });
  await app.register(multipart, { limits: uploadLimits });
  let busy = false;
  app.get('/health', async () => ({ ok: true }));
  app.post('/compile', async (request, reply) => {
    if (busy) return reply.status(503).send('编译服务忙，请稍后重试');
    busy = true;
    try {
      const rawEntry = request.headers['x-typst-entry'];
      if (typeof rawEntry !== 'string') throw new HttpError(400, '缺少编译入口');
      const entry = virtualPath(decodeURIComponent(rawEntry));
      const pdf = await nativeCompiler.compile(await readUpload(request), entry);
      return reply.type('application/pdf').send(pdf);
    } catch (error) {
      return reply
        .status(error instanceof HttpError ? error.statusCode : 400)
        .type('text/plain; charset=utf-8')
        .send(error instanceof HttpError ? error.message : '编译请求无效');
    } finally {
      busy = false;
    }
  });
  return app;
}
if (process.argv[1]?.endsWith('/compiler.ts')) {
  const app = await createCompilerApp();
  await app.listen({
    port: Number(process.env.COMPILER_PORT || 3001),
    host: process.env.COMPILER_HOST || '127.0.0.1',
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
