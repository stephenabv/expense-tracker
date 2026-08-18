#!/usr/bin/env node
/**
 * Applies the database schema.
 *
 *   npm run db:migrate
 *
 * The script is idempotent — every statement is CREATE ... IF NOT EXISTS — so
 * it is safe to run against an existing database.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and set it first.",
  );
  process.exit(1);
}

const sql = readFileSync(join(process.cwd(), "db", "migrations", "001_init.sql"), "utf8");

const client = new pg.Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log("Schema applied.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
