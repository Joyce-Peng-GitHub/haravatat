import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { testDatabase } from './database.js';

test('OAuth binds state to browser, consumes once, rotates sessions and protects logout', async () => {
  const { db, close } = await testDatabase();
  let exchanges = 0;
  const app = await createApp({
    db,
    config: loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused',
      GITHUB_CLIENT_ID: 'client',
      GITHUB_CLIENT_SECRET: 'secret',
    }),
    github: {
      async exchange() {
        exchanges++;
        return {
          id: 42,
          login: 'alice',
          name: 'Alice',
          avatar_url: 'https://avatars.githubusercontent.com/u/42',
        };
      },
    },
  });
  try {
    const start = await app.inject('/auth/github');
    assert.equal(start.statusCode, 302);
    const location = new URL(start.headers.location!);
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    const state = location.searchParams.get('state')!;
    const url = `/auth/github/callback?code=test&state=${state}`;
    assert.equal((await app.inject(url)).statusCode, 400);
    assert.equal(exchanges, 0);
    const finish = await app.inject({ url, cookies: { oauth_state: state } });
    assert.equal(finish.statusCode, 302);
    const session = finish.cookies.find((c) => c.name === 'session')!.value;
    assert.equal((await app.inject({ url, cookies: { oauth_state: state } })).statusCode, 400);
    assert.equal(exchanges, 1);
    assert.equal(
      (await app.inject({ url: '/api/me', cookies: { session } })).json().user.login,
      'alice',
    );
    assert.equal(
      (await db.query('SELECT token_hash FROM sessions')).rows[0].token_hash === session,
      false,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/auth/logout', cookies: { session } })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/logout',
          cookies: { session },
          headers: { origin: 'http://localhost:5173', 'x-haravatat-request': '1' },
        })
      ).statusCode,
      200,
    );
    assert.equal((await app.inject({ url: '/api/me', cookies: { session } })).json().user, null);
  } finally {
    await app.close();
    await close();
  }
});
