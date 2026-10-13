import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './database.js';

test('PostgreSQL schema enforces ownership and rolls back failed transactions', async () => {
  const { db, close } = await testDatabase();
  try {
    await db.query("INSERT INTO users VALUES (1, 'alice', 'Alice', '')");
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO sources (id, user_id, name, kind) VALUES ('00000000-0000-4000-8000-000000000001', 1, 'notes', 'upload')",
        );
        await tx.query(
          "INSERT INTO sources (id, user_id, name, kind) VALUES ('00000000-0000-4000-8000-000000000002', 2, 'invalid owner', 'upload')",
        );
      }),
    );
    assert.equal((await db.query('SELECT * FROM sources')).rows.length, 0);
  } finally {
    await close();
  }
});
