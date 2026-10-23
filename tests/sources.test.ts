import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hash } from '../server/auth.js';
import { testDatabase } from './database.js';
import { virtualPath, validateFiles } from '../server/files.js';

test('virtual paths reject traversal, duplicates, directory conflicts and quotas', () => {
  for (const path of [
    '../secret',
    '/etc/passwd',
    'a/../b',
    'a\\b',
    'a//b',
    '.git/config',
    'C:/file',
    'a\0b',
  ])
    assert.throws(() => virtualPath(path));
  assert.equal(virtualPath('笔记/定理.typ'), '笔记/定理.typ');
  assert.throws(() =>
    validateFiles([
      { path: 'a', content: Buffer.from('x') },
      { path: 'a/b', content: Buffer.from('y') },
    ]),
  );
  assert.throws(() => validateFiles([{ path: 'a', content: Buffer.alloc(8 * 1024 * 1024 + 1) }]));
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
