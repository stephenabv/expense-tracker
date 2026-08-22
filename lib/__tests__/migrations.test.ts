import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/db";
import { migrationFiles, readMigration, splitStatements } from "@/lib/db/client";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

const TABLES = [
  "users",
  "email_verification_tokens",
  "password_reset_tokens",
  "budgets",
  "expenses",
] as const;

describe("splitStatements", () => {
  it("keeps a dollar-quoted block whole", () => {
    const sql = [
      "CREATE TABLE t (id int);",
      "DO $do$",
      "BEGIN",
      "  PERFORM 1;",
      "  PERFORM 2;",
      "END",
      "$do$;",
      "CREATE TABLE u (id int);",
    ].join("\n");

    const statements = splitStatements(sql);

    expect(statements).toHaveLength(3);
    // The block must survive as one statement, semicolons and all.
    expect(statements[1]).toContain("PERFORM 1;");
    expect(statements[1]).toContain("PERFORM 2;");
    expect(statements[1]).toContain("END");
  });

  it("drops comment-only lines without losing statements", () => {
    const statements = splitStatements("-- a comment\nSELECT 1;\n-- another\nSELECT 2;");
    expect(statements).toHaveLength(2);
  });
});

describe("the migration list", () => {
  it("is read lazily, not while the module loads", async () => {
    /*
     * The bug this guards against took production down.
     *
     * The list was once a module-level constant built by reading the
     * migrations directory. Every route that touches the database imports this
     * module, and a serverless bundle does not carry `db/migrations` — so the
     * read threw ENOENT while the module was still loading and every one of
     * those pages died, sign-in included. Importing must never touch the disk.
     */
    const cwd = process.cwd();
    const elsewhere = mkdtempSync(join(tmpdir(), "no-migrations-"));

    try {
      process.chdir(elsewhere);
      vi.resetModules();
      // The import itself must succeed with no migrations directory in sight.
      const fresh = await import("@/lib/db/client");
      expect(typeof fresh.migrationFiles).toBe("function");
      // Only asking for the list looks at the disk, and it says where it looked.
      expect(() => fresh.migrationFiles()).toThrow(/Could not read migrations from/);
    } finally {
      process.chdir(cwd);
      vi.resetModules();
    }
  });

  it("is in filename order, so a new file is picked up by adding it", () => {
    const files = migrationFiles();
    expect(files).toEqual([...files].sort());
    expect(files[0]).toBe("001_init.sql");
    expect(files.length).toBeGreaterThanOrEqual(5);
  });
});

describe("migrations", () => {
  it("applies cleanly and is safe to run twice", async () => {
    // `createTestDatabase` already migrated once; running the whole set again
    // must not error.
    for (const file of migrationFiles()) {
      for (const statement of splitStatements(readMigration(file))) {
        await db.query(statement);
      }
    }

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [[...TABLES]],
    );
    expect(Number(rows[0].count)).toBe(TABLES.length);
  });

  it("enables row level security on every table", async () => {
    // Without this, a PostgREST-backed host would serve these tables — including
    // password hashes — to its public browser key.
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname = ANY($1) AND relkind = 'r'`,
      [[...TABLES]],
    );

    expect(rows).toHaveLength(TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
    }
  });

  it("defines no policies, so the deny-all is total", async () => {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public'`,
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("leaves the owning role able to work normally", async () => {
    // The app connects as the owner, which bypasses RLS; the deny-all must not
    // lock the application out of its own tables.
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (id, name, gender, email, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ["rls-check", "RLS Check", "prefer_not_to_say", "rls@example.com", "hash"],
    );
    expect(rows[0].id).toBe("rls-check");

    const read = await db.query(`SELECT id FROM users WHERE id = $1`, ["rls-check"]);
    expect(read.rows).toHaveLength(1);

    await db.query(`DELETE FROM users WHERE id = $1`, ["rls-check"]);
  });
});

describe("003_optional_budget_period", () => {
  it("is listed so a fresh database gets it", () => {
    expect(migrationFiles()).toContain("003_optional_budget_period.sql");
  });

  it("leaves the period columns nullable", async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'budgets' AND column_name IN ('start_date', 'end_date')
        ORDER BY column_name`,
    );

    expect(rows.map((row) => row.is_nullable)).toEqual(["YES", "YES"]);
  });

  it("still rejects a half-set period", async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (id, name, gender, email, password_hash)
       VALUES ('u-period', 'T', 'prefer_not_to_say', 'period@example.com', 'x')
       RETURNING id`,
    );
    const userId = rows[0].id;

    await expect(
      db.query(
        `INSERT INTO budgets (id, user_id, name, amount_centavos, start_date, end_date)
         VALUES ('b-half', $1, 'Half', 100, '2026-08-01', NULL)`,
        [userId],
      ),
    ).rejects.toBeTruthy();

    // Both null is fine — that is a general allotment.
    await db.query(
      `INSERT INTO budgets (id, user_id, name, amount_centavos, start_date, end_date)
       VALUES ('b-general', $1, 'General', 100, NULL, NULL)`,
      [userId],
    );

    const { rows: stored } = await db.query<{ start_date: string | null }>(
      `SELECT start_date FROM budgets WHERE id = 'b-general'`,
    );
    expect(stored[0].start_date).toBeNull();
  });

  it("still enforces the date format and ordering on dated budgets", async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (id, name, gender, email, password_hash)
       VALUES ('u-fmt', 'T', 'prefer_not_to_say', 'fmt@example.com', 'x')
       RETURNING id`,
    );
    const userId = rows[0].id;

    await expect(
      db.query(
        `INSERT INTO budgets (id, user_id, name, amount_centavos, start_date, end_date)
         VALUES ('b-fmt', $1, 'Bad', 100, 'not-a-date', 'not-a-date')`,
        [userId],
      ),
    ).rejects.toBeTruthy();

    await expect(
      db.query(
        `INSERT INTO budgets (id, user_id, name, amount_centavos, start_date, end_date)
         VALUES ('b-order', $1, 'Backwards', 100, '2026-08-05', '2026-08-01')`,
        [userId],
      ),
    ).rejects.toBeTruthy();
  });
});
