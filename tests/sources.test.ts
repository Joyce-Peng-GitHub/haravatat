import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hash } from '../server/auth.js';
import { testDatabase } from './database.js';
import { MAX_FILES, MAX_SOURCE_BYTES, virtualPath, validateFiles } from '../server/files.js';

test('virtual paths reject traversal, duplicates, directory conflicts and quotas', () => {
  for (const path of ['../secret', '/etc/passwd', 'a/../b', 'a\\b', 'a//b', 'C:/file', 'a\0b'])
    assert.throws(() => virtualPath(path));
  assert.equal(virtualPath('笔记/定理.typ'), '笔记/定理.typ');
  assert.equal(virtualPath('notes/.git/config'), 'notes/.git/config');
  assert.throws(() =>
    validateFiles([
      { path: 'a', content: Buffer.from('x') },
      { path: 'a/b', content: Buffer.from('y') },
    ]),
  );
  const block = Buffer.alloc(1024 * 1024);
  const full = Array.from({ length: MAX_FILES }, (_, index) => ({
    path: `${index}`,
    content: block,
  }));
  assert.equal(MAX_FILES, 1024);
  assert.equal(MAX_SOURCE_BYTES, 1024 ** 3);
  assert.doesNotThrow(() => validateFiles(full));
  assert.throws(
    () => validateFiles([...full, { path: 'extra', content: Buffer.alloc(0) }]),
    /1024/,
  );
  assert.throws(
    () =>
      validateFiles([
        ...full.slice(1),
        { path: 'larger', content: Buffer.alloc(block.length + 1) },
      ]),
    /1 GiB/,
  );
  assert.doesNotThrow(() =>
    validateFiles([{ path: 'large', content: Buffer.alloc(9 * 1024 * 1024) }]),
  );
});

test('source operations enforce user isolation and sync transactionally', async () => {
  const { db, close } = await testDatabase();
  await db.query("INSERT INTO users VALUES (1,'alice','Alice',''),(2,'bob','Bob','')");
  await db.query(
    "INSERT INTO sessions VALUES ($1,1,now()+interval '1 day'),($2,2,now()+interval '1 day')",
    [hash('alice'), hash('bob')],
  );
  let failSync = false;
  let observedToken: string | undefined;
  let observedUsername: string | undefined;
  let observedRepository: string | undefined;
  let observedCommit: string | undefined;
  const app = await createApp({
    db,
    config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused' }),
    repositories: {
      async snapshot(repository, _branch, token, username, commit) {
        observedRepository = repository;
        observedCommit = commit;
        observedUsername = username;
        observedToken = token;
        if (failSync) throw new Error('network failed');
        return {
          commit: 'a'.repeat(40),
          files: [{ path: 'nested/entry.typ', content: Buffer.from('= Hello') }],
        };
      },
    },
  });
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
    session = 'alice',
  ) =>
    app.inject({
      method,
      url,
      payload,
      cookies: { session },
      headers: { origin: 'http://localhost:5173', 'x-haravatat-request': '1' },
    });
  try {
    assert.equal((await req('GET', '/api/sources', undefined, 'unknown')).statusCode, 401);
    const create = await req('POST', '/api/sources', { kind: 'upload', name: '笔记' });
    const id = create.json().source.id;
    assert.equal(create.statusCode, 201);
    const base = `/api/sources/${id}`;
    assert.equal(
      (await req('PUT', `${base}/file`, { path: 'nested/hello.md', content: '# Hello' }))
        .statusCode,
      200,
    );
    assert.equal((await req('GET', base, undefined, 'bob')).statusCode, 404);
    assert.equal(
      (await req('PUT', `${base}/file`, { path: '../secret', content: 'bad' })).statusCode,
      400,
    );
    assert.equal(
      (await req('PUT', `${base}/file`, { path: 'nested', content: 'conflict' })).statusCode,
      409,
    );
    assert.equal((await req('GET', base)).json().files.length, 1);
    assert.equal(
      (await req('POST', `${base}/move`, { from: 'nested', to: 'notes' })).statusCode,
      200,
    );
    assert.equal((await req('GET', `${base}/file?path=notes%2Fhello.md`)).body, '# Hello');
    assert.equal((await req('DELETE', `${base}/file?path=notes`)).statusCode, 200);
    assert.equal((await req('GET', base)).json().files.length, 0);
    const legacy = await req('POST', '/api/sources', {
      kind: 'github',
      name: 'legacy',
      repository: 'alice/notes',
      branch: 'main',
    });
    assert.equal(legacy.statusCode, 201);
    assert.equal(
      (await req('POST', `/api/sources/${legacy.json().source.id}/sync`)).statusCode,
      200,
    );
    const repo = (
      await req('POST', '/api/sources', {
        kind: 'git',
        name: 'repo',
        repository: 'https://gitlab.com/group/subgroup/notes.git',
        branch: 'feature/blog',
        commit: 'a'.repeat(40),
      })
    ).json().source.id;
    assert.equal(
      (
        await req('POST', `/api/sources/${repo}/sync`, {
          token: 'test.token+/=secret',
          username: 'git-user',
        })
      ).statusCode,
      200,
    );
    assert.equal(observedToken, 'test.token+/=secret');
    assert.equal(observedUsername, 'git-user');
    assert.equal(observedCommit, 'a'.repeat(40));
    assert.equal(observedRepository, 'https://gitlab.com/group/subgroup/notes.git');
    assert.equal(
      JSON.stringify((await req('GET', `/api/sources/${repo}`)).json()).includes(
        'test.token+/=secret',
      ),
      false,
    );
    assert.equal(
      (await req('GET', `/api/sources/${repo}`)).json().source.commit_sha,
      'a'.repeat(40),
    );
    assert.equal(
      (
        await req('POST', '/api/sources', {
          kind: 'git',
          name: 'invalid',
          repository: 'https://gitlab.com/group/repo.git',
          commit: 'invalid',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await req('POST', `/api/sources/${repo}/sync`, { commit: 'b'.repeat(40) })).statusCode,
      200,
    );
    assert.equal(observedCommit, 'b'.repeat(40));
    assert.equal(
      (await req('GET', `/api/sources/${repo}`)).json().source.target_commit,
      'b'.repeat(40),
    );
    assert.equal((await req('POST', `/api/sources/${repo}/sync`, { commit: '' })).statusCode, 200);
    assert.equal(observedCommit, undefined);
    assert.equal((await req('GET', `/api/sources/${repo}`)).json().source.target_commit, null);
    failSync = true;
    assert.equal(
      (await req('POST', `/api/sources/${repo}/sync`, { commit: 'c'.repeat(40) })).statusCode,
      500,
    );
    assert.equal((await req('GET', `/api/sources/${repo}`)).json().source.target_commit, null);
    assert.equal((await req('GET', `/api/sources/${repo}`)).json().files.length, 1);
    assert.equal(
      (await req('PUT', `/api/sources/${repo}/file`, { path: 'x.md', content: 'x' })).statusCode,
      409,
    );
    assert.equal((await req('DELETE', base, undefined, 'bob')).statusCode, 404);
    assert.equal((await req('DELETE', base)).statusCode, 200);
  } finally {
    await app.close();
    await close();
  }
});

test('large multipart files round-trip through chunk storage and edits preserve quota rollback', async () => {
  const { db, close } = await testDatabase();
  await db.query("INSERT INTO users VALUES (1,'alice','Alice','')");
  await db.query("INSERT INTO sessions VALUES ($1,1,now()+interval '1 day')", [hash('alice')]);
  const app = await createApp({
    db,
    config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused' }),
  });
  const req = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: object | Buffer,
    contentType?: string,
  ) =>
    app.inject({
      method,
      url,
      payload,
      cookies: { session: 'alice' },
      headers: {
        origin: 'http://localhost:5173',
        'x-haravatat-request': '1',
        ...(contentType ? { 'content-type': contentType } : {}),
      },
    });
  const multipart = (files: { path: string; content: Buffer }[]) =>
    Buffer.concat([
      ...files.flatMap((file) => [
        Buffer.from(
          `--test-boundary\r\nContent-Disposition: form-data; name="files"; filename="${encodeURIComponent(file.path)}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        file.content,
        Buffer.from('\r\n'),
      ]),
      Buffer.from('--test-boundary--\r\n'),
    ]);
  try {
    const id = (await req('POST', '/api/sources', { kind: 'upload', name: 'large' })).json().source
      .id;
    const base = `/api/sources/${id}`;
    const content = Buffer.alloc(9 * 1024 * 1024, 0xa5);
    content[content.length - 1] = 0x7f;
    const upload = await req(
      'POST',
      `${base}/upload`,
      multipart([{ path: '资料/large.bin', content }]),
      'multipart/form-data; boundary=test-boundary',
    );
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal((await req('GET', base)).json().files[0].size, content.length);
    assert.equal(
      (await db.query('SELECT * FROM file_chunks WHERE source_id=$1', [id])).rows.length,
      3,
    );
    assert.deepEqual(
      (await req('GET', `${base}/file?path=${encodeURIComponent('资料/large.bin')}`)).rawPayload,
      content,
    );
    assert.equal(
      (await req('POST', `${base}/move`, { from: '资料', to: 'moved' })).statusCode,
      200,
    );
    assert.deepEqual((await req('GET', `${base}/file?path=moved/large.bin`)).rawPayload, content);
    const revision = (await req('GET', base)).json().source.revision;
    const invalid = await req(
      'POST',
      `${base}/upload`,
      multipart([
        { path: 'notes/../config', content: Buffer.from('metadata') },
        { path: 'valid.md', content: Buffer.from('# Must not be partially saved') },
      ]),
      'multipart/form-data; boundary=test-boundary',
    );
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.match(invalid.json().error, /相对路径/);
    assert.equal((await req('GET', base)).json().source.revision, revision);
    assert.equal((await req('GET', base)).json().files.length, 1);
    const overflow = await req(
      'POST',
      `${base}/upload`,
      multipart(
        Array.from({ length: MAX_FILES }, (_, i) => ({ path: `f${i}`, content: Buffer.alloc(0) })),
      ),
      'multipart/form-data; boundary=test-boundary',
    );
    assert.equal(overflow.statusCode, 413, overflow.body);
    assert.match(overflow.json().error, /1024/);
    assert.equal((await req('GET', base)).json().source.revision, revision);
    const tooMany = await req(
      'POST',
      `${base}/upload`,
      multipart(
        Array.from({ length: MAX_FILES + 1 }, (_, i) => ({
          path: `f${i}`,
          content: Buffer.alloc(0),
        })),
      ),
      'multipart/form-data; boundary=test-boundary',
    );
    assert.equal(tooMany.statusCode, 413, tooMany.body);
    assert.match(tooMany.json().error, /1024/);
    assert.equal((await req('DELETE', `${base}/file?path=moved`)).statusCode, 200);
    assert.equal(
      (await db.query('SELECT * FROM file_chunks WHERE source_id=$1', [id])).rows.length,
      0,
    );
    const exact = await req(
      'POST',
      `${base}/upload`,
      multipart(
        Array.from({ length: MAX_FILES }, (_, i) => ({ path: `f${i}`, content: Buffer.alloc(0) })),
      ),
      'multipart/form-data; boundary=test-boundary',
    );
    assert.equal(exact.statusCode, 200, exact.body);
    assert.equal((await req('GET', base)).json().files.length, 1024);
    // Replacing an existing path must not count as adding a 1025th file.
    assert.equal(
      (
        await req(
          'POST',
          `${base}/upload`,
          multipart([{ path: 'f0', content: Buffer.from('replacement') }]),
          'multipart/form-data; boundary=test-boundary',
        )
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    await close();
  }
});

test('persistent folders support nested creation, safe renames, conflicts and recursive deletion', async () => {
  const { db, close } = await testDatabase();
  await db.query("INSERT INTO users VALUES (1,'alice','Alice',''),(2,'bob','Bob','')");
  await db.query(
    "INSERT INTO sessions VALUES ($1,1,now()+interval '1 day'),($2,2,now()+interval '1 day')",
    [hash('alice'), hash('bob')],
  );
  const app = await createApp({
    db,
    config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused' }),
  });
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
    session = 'alice',
  ) =>
    app.inject({
      method,
      url,
      payload,
      cookies: { session },
      headers: { origin: 'http://localhost:5173', 'x-haravatat-request': '1' },
    });
  try {
    const id = (await req('POST', '/api/sources', { kind: 'upload', name: 'folders' })).json()
      .source.id;
    const base = `/api/sources/${id}`;
    const state = async () => (await req('GET', base)).json();
    assert.equal(
      (await req('POST', `${base}/directory`, { path: 'notes/empty/nested' })).statusCode,
      200,
    );
    assert.deepEqual((await state()).directories, ['notes', 'notes/empty', 'notes/empty/nested']);
    assert.equal((await state()).files.length, 0);
    assert.equal(
      (await req('POST', `${base}/directory`, { path: 'other' }, 'bob')).statusCode,
      404,
    );
    assert.equal((await req('POST', `${base}/directory`, { path: '../secret' })).statusCode, 400);
    const original = await state();
    for (const [method, url, body] of [
      ['POST', '/directory', { path: 'notes' }],
      ['PUT', '/file', { path: 'notes/empty', content: 'conflict' }],
      ['POST', '/move', { from: 'notes', to: 'notes/inside' }],
      ['POST', '/move', { from: 'notes/empty', to: 'notes' }],
    ] as const) {
      assert.equal((await req(method, base + url, body)).statusCode, 409);
      assert.deepEqual(await state(), original);
    }
    assert.equal(
      (await req('PUT', `${base}/file`, { path: 'notes/entry.md', content: '# content' }))
        .statusCode,
      200,
    );
    assert.equal(
      (await req('POST', `${base}/directory`, { path: 'notes/entry.md/child' })).statusCode,
      409,
    );
    const beforeLongMove = await state();
    assert.equal(
      (await req('POST', `${base}/move`, { from: 'notes', to: 'x'.repeat(495) })).statusCode,
      400,
    );
    assert.deepEqual(await state(), beforeLongMove);

    // Moving a directory retains empty descendants and the file content.
    assert.equal(
      (await req('POST', `${base}/move`, { from: 'notes', to: 'archive/renamed' })).statusCode,
      200,
    );
    assert.deepEqual((await state()).directories, [
      'archive',
      'archive/renamed',
      'archive/renamed/empty',
      'archive/renamed/empty/nested',
    ]);
    assert.equal(
      (await req('GET', `${base}/file?path=archive/renamed/entry.md`)).body,
      '# content',
    );
    assert.equal(
      (
        await req('POST', `${base}/move`, {
          from: 'archive/renamed/entry.md',
          to: 'archive/renamed/new.md',
        })
      ).statusCode,
      200,
    );
    assert.equal((await req('DELETE', `${base}/file?path=archive/renamed/new.md`)).statusCode, 200);
    assert((await state()).directories.includes('archive/renamed'));
    assert.equal(
      (await req('POST', `${base}/move`, { from: 'archive/renamed/empty', to: 'empty' }))
        .statusCode,
      200,
    );
    assert((await state()).directories.includes('empty/nested'));
    assert.equal((await req('DELETE', `${base}/file?path=empty`)).statusCode, 200);
    assert(!(await state()).directories.some((path: string) => path.startsWith('empty')));
    // Names with SQL wildcard characters must not affect neighboring paths.
    for (const path of ['a%/inside', 'abc/inside', 'a_/inside'])
      assert.equal((await req('POST', `${base}/directory`, { path })).statusCode, 200);
    assert.equal((await req('DELETE', `${base}/file?path=a%25`)).statusCode, 200);
    assert((await state()).directories.includes('abc/inside'));
    assert((await state()).directories.includes('a_/inside'));
    assert.equal((await req('DELETE', base)).statusCode, 200);
    assert.equal(
      (await db.query('SELECT * FROM directories WHERE source_id=$1', [id])).rows.length,
      0,
    );
  } finally {
    await app.close();
    await close();
  }
});
