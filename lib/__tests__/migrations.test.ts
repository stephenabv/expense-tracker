import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/db";
import { MIGRATIONS, readMigration, splitStatements } from "@/lib/db/client";

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

describe("migrations", () => {
  it("applies cleanly and is safe to run twice", async () => {
    // `createTestDatabase` already migrated once; running the whole set again
    // must not error.
    for (const file of MIGRATIONS) {
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
