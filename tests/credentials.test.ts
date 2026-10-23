import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hash } from '../server/auth.js';
import { credentialStore } from '../server/credentials.js';
import { HttpError } from '../server/errors.js';
import { testDatabase } from './database.js';

const encryptionKey = 'a'.repeat(64);

test('saved PATs are encrypted, bound to their repository and reusable after restart', async () => {
  const { db, close } = await testDatabase();
  await db.query("INSERT INTO users VALUES (1,'alice','Alice',''),(2,'bob','Bob','')");
  await db.query(
    "INSERT INTO sessions VALUES ($1,1,now()+interval '1 day'),($2,2,now()+interval '1 day')",
    [hash('alice'), hash('bob')],
  );
  const calls: { token?: string; username?: string; commit?: string }[] = [];
  let commit = 'a'.repeat(40),
    fail = false;
  const app = await createApp({
    db,
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused',
      CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    }),
    repositories: {
      async snapshot(_url, _branch, token, username, target) {
        calls.push({ token, username, commit: target });
        if (fail) throw new HttpError(502, '仓库同步失败');
        return {
          commit: target || commit,
          files: [{ path: 'main.md', content: Buffer.from(`# ${commit}`) }],
        };
      },
    },
  });
  let requestAddress = 0;
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
    session = 'alice',
  ) =>
    app.inject({
      method,
      url,
      payload,
      // Exercise the sync scenarios without waiting for the production per-IP rate window.
      remoteAddress: `192.0.2.${++requestAddress}`,
      cookies: { session },
      headers: { origin: 'http://localhost:5173', 'x-haravatat-request': '1' },
    });
  try {
    const created = await req('POST', '/api/sources', {
      kind: 'git',
      name: 'Private notes',
      repository: 'https://git.example.com/group/notes.git',
      branch: 'main',
    });
    const source = created.json().source,
      base = `/api/sources/${source.id}`;
    assert.equal(source.auto_sync, false);
    assert.equal(source.has_credentials, false);
    const credential = { token: 'secret-PAT+/=test', username: 'repo-user' };
    assert.equal((await req('PUT', `${base}/credentials`, credential, 'bob')).statusCode, 404);
    assert.equal((await req('PUT', `${base}/credentials`, { token: '' })).statusCode, 400);
    assert.equal((await req('PUT', `${base}/credentials`, credential)).statusCode, 200);
    const encrypted = Buffer.from(
      (
        await db.query('SELECT encrypted FROM repository_credentials WHERE source_id=$1', [
          source.id,
        ])
      ).rows[0].encrypted,
    );
    assert.equal(encrypted.includes(Buffer.from(credential.token)), false);
    assert.equal(encrypted.includes(Buffer.from(credential.username)), false);
    // A newly constructed store reads the persistent envelope with the same deployment key.
    assert.deepEqual(await credentialStore(db, encryptionKey).read(source), credential);
    await assert.rejects(credentialStore(db, 'b'.repeat(64)).read(source), /无法解密/);
    await assert.rejects(
      credentialStore(db, encryptionKey).read({
        ...source,
        repository: 'https://other.example.com/repo',
      }),
      /无法解密/,
    );
    await assert.rejects(
      credentialStore(db, encryptionKey).read({ ...source, user_id: '2' }),
      /无法解密/,
    );
    await credentialStore(db, encryptionKey).save(source, credential);
    const reencrypted = Buffer.from(
      (
        await db.query('SELECT encrypted FROM repository_credentials WHERE source_id=$1', [
          source.id,
        ])
      ).rows[0].encrypted,
    );
    assert.notDeepEqual(reencrypted, encrypted);
    const tampered = Buffer.from(reencrypted);
    tampered[tampered.length - 1] ^= 1;
    await db.query('UPDATE repository_credentials SET encrypted=$2 WHERE source_id=$1', [
      source.id,
      tampered,
    ]);
    const invalid = await req('POST', `${base}/sync`);
    assert.equal(invalid.statusCode, 503);
    assert.equal(invalid.body.includes(credential.token), false);
    assert.equal((await req('PUT', `${base}/credentials`, credential)).statusCode, 200);
    for (const url of [base, '/api/sources']) {
      const response = await req('GET', url);
      assert.equal(response.body.includes(credential.token), false);
      assert.equal(response.body.includes(credential.username), false);
      assert.equal(response.body.includes('encrypted'), false);
    }
    assert.equal((await req('GET', base)).json().source.has_credentials, true);
    assert.equal((await req('GET', base)).json().credentialStorageAvailable, true);
    assert.equal(
      (await req('PATCH', `${base}/settings`, { autoSync: true }, 'bob')).statusCode,
      404,
    );
    assert.equal((await req('POST', `${base}/sync`, { automatic: true })).json().skipped, true);
    assert.equal(calls.length, 0);
    assert.equal((await req('PATCH', `${base}/settings`, { autoSync: true })).statusCode, 200);
    assert.equal((await req('POST', `${base}/sync`, { automatic: true })).statusCode, 200);
    assert.deepEqual(calls.at(-1), { ...credential, commit: undefined });
    const publication = await req('POST', `${base}/publish`, { entries: [{ path: 'main.md' }] });
    assert.equal(publication.statusCode, 200, publication.body);
    const publicPath = `/api/posts/${publication.json().posts[0].id}`;
    const publishedMarkdown = (await app.inject(publicPath)).json().post.markdown;
    const initial = (await req('GET', base)).json();
    assert.equal((await req('POST', `${base}/sync`)).json().unchanged, true);
    assert.equal((await req('GET', base)).json().source.revision, initial.source.revision);
    assert.equal(
      (await req('POST', `${base}/sync`, { token: 'one-off', username: 'temporary' })).statusCode,
      200,
    );
    assert.equal(calls.at(-1)?.token, 'one-off');
    assert.deepEqual(await credentialStore(db, encryptionKey).read(source), credential);
    commit = 'b'.repeat(40);
    assert.equal((await req('POST', `${base}/sync`, { automatic: true })).statusCode, 200);
    assert.equal(calls.at(-1)?.token, credential.token);
    assert.equal((await req('GET', base)).json().source.revision, initial.source.revision + 1);
    assert.equal((await app.inject(publicPath)).json().post.markdown, publishedMarkdown);
    const beforeFailure = (await req('GET', base)).json();
    fail = true;
    assert.equal((await req('POST', `${base}/sync`, { commit: 'c'.repeat(40) })).statusCode, 502);
    assert.deepEqual((await req('GET', base)).json(), beforeFailure);
    assert.equal((await req('DELETE', `${base}/credentials`, undefined, 'bob')).statusCode, 404);
    assert.equal((await req('DELETE', `${base}/credentials`)).statusCode, 200);
    const removed = (await req('GET', base)).json().source;
    assert.equal(removed.has_credentials, false);
    assert.equal(removed.auto_sync, false);
    assert.equal(await credentialStore(db, encryptionKey).read(source), undefined);
    fail = false;
    assert.equal((await req('POST', `${base}/sync`)).statusCode, 200);
    assert.equal(calls.at(-1)?.token, undefined);
    await req('PUT', `${base}/credentials`, credential);
    assert.equal((await req('DELETE', base)).statusCode, 200);
    assert.equal((await db.query('SELECT * FROM repository_credentials')).rows.length, 0);
  } finally {
    await app.close();
    await close();
  }
});

test('credential storage requires an explicit deployment key while one-off sync remains usable', async () => {
  const { db, close } = await testDatabase();
  await db.query("INSERT INTO users VALUES (1,'alice','Alice','')");
  await db.query("INSERT INTO sessions VALUES ($1,1,now()+interval '1 day')", [hash('alice')]);
  const app = await createApp({
    db,
    config: loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused' }),
    repositories: {
      async snapshot(_url, _branch, token) {
        assert.equal(token, 'temporary');
        return { commit: 'a'.repeat(40), files: [] };
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
    assert.throws(() =>
      loadConfig({ DATABASE_URL: 'postgres://unused', CREDENTIAL_ENCRYPTION_KEY: 'short' }),
    );
    const source = (
      await req('POST', '/api/sources', {
        kind: 'git',
        name: 'notes',
        repository: 'https://git.example.com/notes.git',
      })
    ).json().source;
    const base = `/api/sources/${source.id}`;
    assert.equal((await req('GET', base)).json().credentialStorageAvailable, false);
    assert.equal((await req('PUT', `${base}/credentials`, { token: 'saved' })).statusCode, 503);
    assert.equal((await req('POST', `${base}/sync`, { token: 'temporary' })).statusCode, 200);
    assert.equal((await db.query('SELECT * FROM repository_credentials')).rows.length, 0);
  } finally {
    await app.close();
    await close();
  }
});
