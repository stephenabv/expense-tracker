/**
 * Telling "the database said no" apart from "there was no database".
 *
 * The distinction is not cosmetic: the sign-in action reports every other
 * failure as "invalid email or password", so an unreachable server used to
 * accuse people of mistyping a password that was in fact correct.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DatabaseUnavailableError,
  getDatabase,
  isDatabaseUnavailableError,
} from "@/lib/db/client";

/** The pool is cached on `globalThis`; a test that swaps the URL must clear it. */
function resetPool(): void {
  const globals = globalThis as typeof globalThis & {
    __expenseTrackerDb?: { pool?: unknown };
  };
  if (globals.__expenseTrackerDb) globals.__expenseTrackerDb.pool = null;
}

describe("isDatabaseUnavailableError", () => {
  it("recognises the error itself", () => {
    expect(isDatabaseUnavailableError(new DatabaseUnavailableError(null))).toBe(
      true,
    );
  });

  it("looks through a `cause` chain", () => {
    const wrapped = new Error("query failed", {
      cause: new DatabaseUnavailableError(new Error("ECONNREFUSED")),
    });

    expect(isDatabaseUnavailableError(wrapped)).toBe(true);
  });

  it("looks through the shape Auth.js wraps a provider error in", () => {
    // CallbackRouteError carries the original under `cause.err`.
    const callbackRouteError = Object.assign(new Error("CallbackRouteError"), {
      cause: {
        err: new DatabaseUnavailableError(new Error("tenant not found")),
        provider: "credentials",
      },
    });

    expect(isDatabaseUnavailableError(callbackRouteError)).toBe(true);
  });

  it("matches by name, so two bundled copies of the class still agree", () => {
    const fromAnotherChunk = Object.assign(new Error("unreachable"), {
      name: "DatabaseUnavailableError",
    });

    expect(isDatabaseUnavailableError(fromAnotherChunk)).toBe(true);
  });

  it("is false for a statement the database rejected", () => {
    // A SQLSTATE means Postgres processed the statement and said no.
    const rejected = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });

    expect(isDatabaseUnavailableError(rejected)).toBe(false);
    expect(isDatabaseUnavailableError(new Error("nope"))).toBe(false);
    expect(isDatabaseUnavailableError(null)).toBe(false);
    expect(isDatabaseUnavailableError("ECONNREFUSED")).toBe(false);
  });

  it("terminates on a cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;

    expect(isDatabaseUnavailableError(a)).toBe(false);
  });
});

describe("a pool that cannot reach its server", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    resetPool();
    // Port 1 on loopback: refused immediately, so nothing here waits on a
    // network timeout or leaves the machine.
    process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:1/postgres";
  });

  afterEach(() => {
    resetPool();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("reports a refused connection as unavailable, not as a query failure", async () => {
    const db = getDatabase();

    await expect(db.query("SELECT 1")).rejects.toSatisfy(
      isDatabaseUnavailableError,
    );
  });

  it("reports the same for a transaction", async () => {
    const db = getDatabase();

    await expect(
      db.transaction!(async (tx) => tx.query("SELECT 1")),
    ).rejects.toSatisfy(isDatabaseUnavailableError);
  });
});
