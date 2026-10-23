import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { readUpload, uploadLimits } from '../server/uploads.js';
import { HttpError } from '../server/errors.js';
import { Readable } from 'node:stream';
import { setTimeout } from 'node:timers/promises';

test('invalid multipart paths consume the remaining bounded stream before returning JSON', async () => {
  const app = Fastify();
  await app.register(multipart, { limits: uploadLimits });
  app.post('/upload', async (request, reply) => {
    try {
      await readUpload(request);
      return { ok: true };
    } catch (error) {
      assert(error instanceof HttpError);
      return reply.status(error.statusCode).send({ error: error.message });
    }
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    for (const path of ['/absolute/path', '%invalid', 'notes/../secret']) {
      const filename = path === '%invalid' ? path : encodeURIComponent(path);
      let fullySent = false;
      async function* body() {
        yield Buffer.from(
          `--boundary\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\nmetadata\r\n`,
        );
        yield Buffer.from(
          '--boundary\r\nContent-Disposition: form-data; name="files"; filename="notes%2Farticle.md"\r\nContent-Type: application/octet-stream\r\n\r\n',
        );
        for (let i = 0; i < 32; i++) {
          await setTimeout(2);
          yield Buffer.alloc(64 * 1024, 0x61);
        }
        fullySent = true;
        yield Buffer.from('\r\n--boundary--\r\n');
      }
      const response = await fetch(`${address}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' },
        body: Readable.toWeb(Readable.from(body())) as ReadableStream<Uint8Array>,
        duplex: 'half',
        signal: AbortSignal.timeout(5000),
      } as RequestInit & { duplex: string });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /路径/);
      assert.equal(fullySent, true, 'must not reply while the client is still uploading');
    }
  } finally {
    await app.close();
  }
});
