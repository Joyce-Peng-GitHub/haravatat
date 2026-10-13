import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../server/db.js';
import { migrate } from '../server/db.js';
export async function testDatabase() {
  const engine = new PGlite();
  const wrap = (client: Pick<PGlite, 'query' | 'transaction'>): Database => ({
    query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    transaction: (work) => client.transaction((tx) => work(wrap(tx as unknown as PGlite))),
  });
  const db = wrap(engine);
  await migrate(db);
  return { db, close: () => engine.close() };
}
