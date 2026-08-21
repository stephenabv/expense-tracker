#!/usr/bin/env node
/**
 * Applies the database schema.
 *
 *   npm run db:migrate
 *
 * The script is idempotent — every statement is CREATE ... IF NOT EXISTS — so
 * it is safe to run against an existing database.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and set it first.",
  );
  process.exit(1);
}

/*
 * The directory is the list.
 *
 * A hand-maintained array here silently stopped applying new migrations the
 * moment someone added a file and forgot this line — which is how a schema
 * change ends up having to be pasted into a database console by hand. The
 * filenames are numerically prefixed, so sorting them is the apply order.
 */
const directory = join(process.cwd(), "db", "migrations");
const MIGRATIONS = readdirSync(directory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (MIGRATIONS.length === 0) {
  console.error(`No migrations found in ${directory}.`);
  process.exit(1);
}

const sql = MIGRATIONS.map((file) =>
  readFileSync(join(directory, file), "utf8"),
).join("\n\n");

const client = new pg.Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);

  // Report the guard that matters most, so a misconfigured host is obvious.
  const { rows } = await client.query(
    `SELECT relname, relrowsecurity FROM pg_class
      WHERE relkind = 'r'
        AND relname IN ('users', 'email_verification_tokens',
                        'password_reset_tokens', 'budgets', 'expenses')
      ORDER BY relname`,
  );

  console.log(`Schema applied (${MIGRATIONS.join(", ")}).\n`);
  for (const row of rows) {
    console.log(
      `  ${row.relrowsecurity ? "\u2713" : "\u2717"} ${row.relname}` +
        `${row.relrowsecurity ? "" : "  <-- row level security is OFF"}`,
    );
  }

  const unprotected = rows.filter((row) => !row.relrowsecurity);
  if (unprotected.length > 0) {
    console.error(
      "\nSome tables have row level security disabled. On a host that exposes " +
        "Postgres over HTTP (Supabase and similar), those tables would be " +
        "readable with the public API key.",
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
