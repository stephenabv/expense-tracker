/**
 * A real Postgres for tests.
 *
 * PGlite runs the actual Postgres engine in-process, so constraints, error
 * codes and SQL semantics behave exactly as they will in production — the
 * queries under test are the queries that ship.
 */

import { PGlite } from "@electric-sql/pglite";

import { migrate, setDatabase, type SqlExecutor } from "@/lib/db/client";

export interface TestDatabase extends SqlExecutor {
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = await PGlite.create();

  const executor: SqlExecutor = {
    async query(text, params) {
      const result = await pg.query(text, params as unknown[]);
      return { rows: result.rows as never[] };
    },
  };

  await migrate(executor);
  setDatabase(executor);

  return {
    query: executor.query,
    async reset() {
      // TRUNCATE cascades to every dependent table, so each test starts clean.
      await pg.exec("TRUNCATE users CASCADE;");
    },
    async close() {
      setDatabase(null);
      await pg.close();
    },
  };
}
