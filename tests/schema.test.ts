import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../server/db.js';
import { testDatabase } from './database.js';
import { sourceFiles } from '../server/sources.js';

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

test('existing workspaces and files survive idempotent schema upgrades', async () => {
  const { db, close } = await testDatabase();
  try {
    await db.query("INSERT INTO users VALUES (1,'alice','Alice','')");
    await db.query('ALTER TABLE sources DROP CONSTRAINT sources_kind_check');
    await db.query(
      "ALTER TABLE sources ADD CONSTRAINT sources_kind_check CHECK (kind IN ('upload','github'))",
    );
    await db.query(
      "INSERT INTO sources (id,user_id,name,kind,repository,branch) VALUES ('00000000-0000-4000-8000-000000000001',1,'legacy','github','alice/notes','main')",
    );
    await db.query('DROP TABLE repository_credentials');
    await db.query('ALTER TABLE sources DROP COLUMN auto_sync');
    await db.query('DROP TABLE file_chunks');
    await db.query('ALTER TABLE files DROP COLUMN byte_size');
    await db.query('INSERT INTO files (source_id,path,content) VALUES ($1,$2,$3)', [
      '00000000-0000-4000-8000-000000000001',
      'legacy.typ',
      Buffer.from('= Preserved'),
    ]);
    await migrate(db);
    await migrate(db);
    assert.equal(
      (await sourceFiles(db, '00000000-0000-4000-8000-000000000001'))[0].content.toString(),
      '= Preserved',
    );
    await db.query(
      "INSERT INTO sources (id,user_id,name,kind,repository,branch) VALUES ('00000000-0000-4000-8000-000000000002',1,'new','git','https://gitlab.com/group/repo.git','main')",
    );
    const upgraded = await db.query('SELECT auto_sync FROM sources');
    assert.equal(upgraded.rows.length, 2);
    assert.ok(upgraded.rows.every((source) => source.auto_sync === false));
    assert.equal((await db.query('SELECT * FROM repository_credentials')).rows.length, 0);
  } finally {
    await close();
  }
});
