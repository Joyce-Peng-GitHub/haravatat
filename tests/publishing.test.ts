import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hash } from '../server/auth.js';
import { testDatabase } from './database.js';
import { nativeCompiler, remoteCompiler } from '../server/compile.js';
import { createCompilerApp } from '../server/compiler.js';
import { HttpError } from '../server/errors.js';

test('publication snapshots selected entries and assets, preserves previous posts on failure', async () => {
  const { db, close } = await testDatabase();
  await db.query("INSERT INTO users VALUES (1,'alice','Alice','')");
  await db.query("INSERT INTO sessions VALUES ($1,1,now()+interval '1 day')", [hash('alice')]);
  let compileFails = false,
    race = false,
    sourceId = '';
  const app = await createApp({
    db,
    config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused' }),
    compiler: {
      async compile() {
        if (compileFails) throw new HttpError(422, 'invalid Typst');
        if (race) await db.query('UPDATE sources SET revision=revision+1 WHERE id=$1', [sourceId]);
        return Buffer.from('%PDF-test');
      },
    },
  });
  const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      payload,
      cookies: { session: 'alice' },
      headers: { origin: 'http://localhost:5173', 'x-haravatat-request': '1' },
    });
  try {
    sourceId = (await req('POST', '/api/sources', { kind: 'upload', name: 'notes' })).json().source
      .id;
    const base = `/api/sources/${sourceId}`;
    await req('PUT', `${base}/file`, {
      path: 'notes/hello.md',
      content:
        '# Heading\n\n![plot](../plot.png)\n\n[Other](other.typ)\n\n[Secret](../secret.txt)\n\n<script>alert(1)</script>',
    });
    await req('PUT', `${base}/file`, { path: 'notes/other.typ', content: '= Other' });
    await req('PUT', `${base}/file`, { path: 'plot.png', content: 'image snapshot' });
    await req('PUT', `${base}/file`, { path: 'secret.txt', content: 'private content' });
    const payload = {
      entries: [{ path: 'notes/hello.md' }, { path: 'notes/other.typ', title: 'Typst title' }],
    };
    const publish = await req('POST', `${base}/publish`, payload);
    assert.equal(publish.statusCode, 200, publish.body);
    const [md, typ] = publish.json().posts;
    const publicPost = (await app.inject(`/api/posts/${md.id}`)).json().post;
    assert.equal(publicPost.title, 'Heading');
    assert.match(publicPost.markdown, new RegExp(`/p/${typ.id}`));
    assert.match(publicPost.markdown, new RegExp(`/api/posts/${md.id}/assets/plot.png`));
    assert.equal((await app.inject(`/api/posts/${md.id}/assets/plot.png`)).body, 'image snapshot');
    assert.equal((await app.inject(`/api/posts/${md.id}/assets/secret.txt`)).statusCode, 404);
    assert.equal((await app.inject(`/api/posts/${typ.id}/pdf`)).body, '%PDF-test');
    await req('PUT', `${base}/file`, { path: 'notes/hello.md', content: '# Changed' });
    compileFails = true;
    assert.equal((await req('POST', `${base}/publish`, payload)).statusCode, 422);
    assert.equal((await app.inject(`/api/posts/${md.id}`)).json().post.title, 'Heading');
    compileFails = false;
    race = true;
    assert.equal((await req('POST', `${base}/publish`, payload)).statusCode, 409);
    assert.equal((await app.inject(`/api/posts/${md.id}`)).json().post.title, 'Heading');
    race = false;
    const updated = await req('POST', `${base}/publish`, { entries: [{ path: 'notes/hello.md' }] });
    assert.equal(updated.json().posts[0].id, md.id);
    assert.equal((await app.inject(`/api/posts/${typ.id}`)).statusCode, 404);
    assert.equal((await app.inject(`/api/posts/${md.id}`)).json().post.title, 'Changed');
    assert.equal((await req('POST', `${base}/publish`, { entries: [] })).statusCode, 200);
    assert.equal((await app.inject('/api/posts')).json().posts.length, 0);
  } finally {
    await app.close();
    await close();
  }
});

test('real Typst compiler builds dependencies and rejects reading outside project root', async () => {
  const pdf = await nativeCompiler.compile(
    [
      {
        path: 'nested/main.typ',
        content: Buffer.from('#include "../part.typ"\n#pagebreak()\nSecond page'),
      },
      { path: 'part.typ', content: Buffer.from('= First page\n$ sum_(i=1)^n i = (n(n+1))/2 $') },
    ],
    'nested/main.typ',
  );
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(
    nativeCompiler.compile(
      [{ path: 'main.typ', content: Buffer.from('#read("../secret.txt")') }],
      'main.typ',
    ),
    /outside|access|root/i,
  );
});

test('remote compiler streams a workspace larger than the former total and per-file limits', async () => {
  const app = await createCompilerApp();
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const pdf = await remoteCompiler(url).compile(
      [
        { path: '笔记/main.typ', content: Buffer.from('= Large workspace') },
        { path: 'large.bin', content: Buffer.alloc(51 * 1024 * 1024, 0xa5) },
      ],
      '笔记/main.typ',
    );
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  } finally {
    await app.close();
  }
});
