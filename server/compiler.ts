import Fastify from 'fastify';
import { z } from 'zod';
import { nativeCompiler } from './compile.js';
import { HttpError } from './errors.js';
import { MAX_SOURCE_BYTES, MAX_FILES } from './files.js';
export async function createCompilerApp() {
  const app = Fastify({
    bodyLimit: Math.ceil(MAX_SOURCE_BYTES * 1.5) + 1024 * 1024,
    logger: false,
    requestTimeout: 40_000,
  });
  let busy = false;
  app.get('/health', async () => ({ ok: true }));
  app.post('/compile', async (request, reply) => {
    if (busy) return reply.status(503).send('编译服务忙，请稍后重试');
    busy = true;
    try {
      const body = z
        .object({
          entry: z.string(),
          files: z
            .array(
              z.object({
                path: z.string(),
                content: z
                  .string()
                  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
              }),
            )
            .max(MAX_FILES),
        })
        .parse(request.body);
      const pdf = await nativeCompiler.compile(
        body.files.map((f) => ({ path: f.path, content: Buffer.from(f.content, 'base64') })),
        body.entry,
      );
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
