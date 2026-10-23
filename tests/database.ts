import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../server/db.js';
import { connectDatabase, migrate } from '../server/db.js';
import { randomUUID } from 'node:crypto';
export async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    const admin = connectDatabase(process.env.TEST_DATABASE_URL);
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const db = connectDatabase(url.href);
    try {
      await migrate(db);
    } catch (error) {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
      throw error;
    }
    return {
      db,
      close: async () => {
        await db.close();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.close();
      },
    };
  }

  const engine = new PGlite();
  const wrap = (client: Pick<PGlite, 'query' | 'transaction' | 'exec'>): Database => ({
    query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      if (!params && sql.includes(';')) {
        await client.exec(sql);
        return { rows: [], rowCount: 0 };
      }
      const result = await client.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    transaction: (work) => client.transaction((tx) => work(wrap(tx as unknown as PGlite))),
  });
  const db = wrap(engine);
  await migrate(db);
  return { db, close: () => engine.close() };
}
