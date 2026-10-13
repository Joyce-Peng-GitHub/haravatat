import pg from 'pg';
import { readFile } from 'node:fs/promises';
export interface Database {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
}
export function connectDatabase(url: string): Database & { close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const wrap = (client: Pick<pg.PoolClient, 'query'>): Database => ({
    query: (sql, params) => client.query(sql, params),
    transaction: async (work) => {
      await client.query('BEGIN');
      try {
        const result = await work(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  });
  return {
    query: (sql, params) => pool.query(sql, params),
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        return await wrap(client).transaction(work);
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(734281)');
    await tx.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  });
}
