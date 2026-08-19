/**
 * Database access.
 *
 * Everything goes through parameterised SQL — values are never interpolated
 * into a statement, so user input cannot alter its structure.
 *
 * Production runs against PostgreSQL through `pg`. Tests run the same SQL
 * against PGlite (Postgres compiled to WASM), so the queries under test are the
 * queries that ship rather than a stand-in.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface SqlResult<T> {
  rows: T[];
}

/** The minimum surface both drivers share. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<SqlResult<T>>;
}

/*
 * Cached on `globalThis`, not in a module variable.
 *
 * The bundler can emit this module into several server chunks, and a dev server
 * re-evaluates it on every reload. A module-scoped cache would then create one
 * connection pool per copy — many more connections than intended, and, for the
 * embedded database, several instances writing the same files with divergent
 * in-memory state. One global slot gives every copy the same database.
 */
interface DatabaseGlobals {
  pool?: SqlExecutor | null;
  override?: SqlExecutor | null;
}

const globals = globalThis as typeof globalThis & {
  __expenseTrackerDb?: DatabaseGlobals;
};

globals.__expenseTrackerDb ??= {};
const cache = globals.__expenseTrackerDb;

/** Injects a database for tests. Pass `null` to restore the real pool. */
export function setDatabase(executor: SqlExecutor | null): void {
  cache.override = executor;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres database.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(cache.override) || Boolean(process.env.DATABASE_URL);
}

/**
 * Embedded Postgres, for development without installing a server.
 *
 * `DATABASE_URL=pglite://./.pgdata` runs PGlite — real Postgres compiled to
 * WASM — inside the server process, persisting to that directory (omit the path
 * for an in-memory database that resets on restart). Convenient for trying the
 * app locally; not for production, where a single process owns the data and
 * nothing else can connect.
 */
function createEmbeddedDatabase(connectionString: string): SqlExecutor {
  const dataDir = connectionString.replace(/^pglite:(\/\/)?/, "").trim();

  const nodeRequire = createRequire(import.meta.url);
  const { PGlite } = nodeRequire("@electric-sql/pglite") as typeof import("@electric-sql/pglite");

  // Created once and shared; every query waits on the same instance.
  const ready = (async () => {
    const pg = await PGlite.create(dataDir ? { dataDir } : undefined);
    await migrate({
      query: async (text, params) => {
        const result = await pg.query(text, params as unknown[]);
        return { rows: result.rows as never[] };
      },
    });
    return pg;
  })();

  return {
    query: async <T,>(text: string, params?: unknown[]) => {
      const pg = await ready;
      const result = await pg.query(text, params as unknown[]);
      return { rows: result.rows as T[] };
    },
  };
}

/** The active database. Created lazily so a build without a URL still succeeds. */
export function getDatabase(): SqlExecutor {
  if (cache.override) return cache.override;
  if (cache.pool) return cache.pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();

  if (connectionString.startsWith("pglite:")) {
    cache.pool = createEmbeddedDatabase(connectionString);
    return cache.pool;
  }

  // Loaded lazily so the driver is not pulled into every bundle that merely
  // imports this module. `createRequire` keeps it a real CommonJS load, which
  // the native `pg` package expects, without a top-level import.
  const nodeRequire = createRequire(import.meta.url);
  const { Pool } = nodeRequire("pg") as typeof import("pg");

  const created = new Pool({
    connectionString,
    // Hosted Postgres (Neon, Supabase, Vercel) terminates TLS with its own CA.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
    // Serverless instances each get their own pool, so a small one is usually
    // right; a pooling proxy in front of the database may want fewer still.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // 0 keeps connections open indefinitely, which suits a long-lived server;
    // the default suits serverless, where idle sockets are wasted.
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS ?? 10_000),
  });

  // A pool that loses a backend must not take the process down with it; the
  // next query simply opens a fresh connection.
  created.on("error", (error) => {
    console.error("Postgres pool error:", error.message);
  });

  cache.pool = {
    query: async <T,>(text: string, params?: unknown[]) => {
      /*
       * Hosted Postgres recycles idle connections, so a pooled socket can be
       * dead by the time it is reused. That surfaces as a connection-level
       * error rather than a SQL error, and reconnecting fixes it. Anything the
       * database actually rejected carries a SQLSTATE code and is rethrown
       * untouched — a failing statement must never be run twice.
       */
      let lastError: unknown;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await created.query(text, params as never[]);
          return { rows: result.rows as T[] };
        } catch (error) {
          if (!isTransientConnectionError(error)) throw error;
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }

      throw lastError;
    },
  };

  return cache.pool;
}

/**
 * True for a dropped or refused connection, as opposed to a statement the
 * database understood and rejected.
 */
function isTransientConnectionError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  // A SQLSTATE code means Postgres processed the statement and said no.
  if (candidate?.code && /^[0-9A-Z]{5}$/.test(candidate.code)) return false;

  const message = candidate?.message ?? "";
  return /Connection terminated|ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|server closed|Client has encountered a connection error/i.test(
    message,
  );
}

/** Migration files, in the order they must be applied. */
export const MIGRATIONS = [
  "001_init.sql",
  "002_restrict_api_roles.sql",
  "003_optional_budget_period.sql",
] as const;

/** One migration's SQL. */
export function readMigration(file: string): string {
  return readFileSync(join(process.cwd(), "db", "migrations", file), "utf8");
}

/** Every migration concatenated, for drivers that accept a multi-statement script. */
export function readAllMigrations(): string {
  return MIGRATIONS.map(readMigration).join("\n\n");
}

/** Applies the schema. Every statement is idempotent, so repeat runs are safe. */
export async function migrate(db: SqlExecutor = getDatabase()): Promise<void> {
  for (const file of MIGRATIONS) {
    // Split so drivers that reject multi-statement strings still work.
    for (const statement of splitStatements(readMigration(file))) {
      await db.query(statement);
    }
  }
}

/**
 * Splits a SQL script into statements.
 *
 * Semicolons inside a dollar-quoted block (`$$ ... $$`) belong to the block, not
 * to the script, so the splitter tracks whether it is inside one. Splitting
 * naively on every semicolon would tear a DO block into fragments that are not
 * valid SQL on their own.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  // The tag of the dollar-quoted block we are inside, or null at top level.
  // Tags can be named (`$do$`) as well as bare (`$$`), and only the matching
  // tag closes a block.
  let openTag: string | null = null;

  const TAG = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g;

  for (const rawLine of sql.split("\n")) {
    const line = rawLine.trim().startsWith("--") ? "" : rawLine;

    TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG.exec(line)) !== null) {
      const tag = match[0];
      if (openTag === null) openTag = tag;
      else if (openTag === tag) openTag = null;
    }

    current += `${line}\n`;

    if (openTag === null && /;\s*$/.test(line)) {
      const statement = current.replace(/;\s*$/, "").trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements;
}

