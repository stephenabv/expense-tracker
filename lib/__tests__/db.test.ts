import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/db";
import {
  EmailAlreadyRegisteredError,
  createUser,
  findUserByEmail,
  findUserCredentials,
  isVerified,
  markEmailVerified,
  updatePasswordHash,
} from "@/lib/db/users";
import {
  consumeAllTokens,
  countRecentTokens,
  redeemToken,
  storeToken,
} from "@/lib/db/tokens";
import {
  deleteBudgetRow,
  insertBudget,
  insertExpense,
  listBudgets,
  listExpenses,
  loadTrackerData,
  updateBudgetRow,
  updateExpenseRow,
  deleteExpenseRow,
} from "@/lib/db/tracker";
import { createToken, hashToken } from "@/lib/auth/tokens";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.reset();
});

async function makeUser(email = "a@example.com") {
  return createUser({
    name: "Test User",
    gender: "prefer_not_to_say",
    email,
    passwordHash: "hash-placeholder",
  });
}

describe("users", () => {
  it("creates a user unverified", async () => {
    const user = await makeUser();
    expect(user.emailVerifiedAt).toBeNull();
    expect(isVerified(user)).toBe(false);
  });

  it("never exposes the hash on the public shape", async () => {
    const user = await makeUser();
    expect(user).not.toHaveProperty("passwordHash");

    const found = await findUserByEmail("a@example.com");
    expect(found).not.toHaveProperty("passwordHash");
  });

  it("reads the hash only through the credentials lookup", async () => {
    await makeUser();
    const credentials = await findUserCredentials("a@example.com");
    expect(credentials?.passwordHash).toBe("hash-placeholder");
  });

  it("rejects a duplicate email at the database level", async () => {
    await makeUser();
    await expect(makeUser()).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it("marks an email verified once", async () => {
    const user = await makeUser();
    await markEmailVerified(user.id);
    const first = await findUserByEmail("a@example.com");
    expect(first?.emailVerifiedAt).toBeInstanceOf(Date);

    await markEmailVerified(user.id);
    const second = await findUserByEmail("a@example.com");
    expect(second?.emailVerifiedAt?.getTime()).toBe(first?.emailVerifiedAt?.getTime());
  });

  it("updates the password hash", async () => {
    const user = await makeUser();
    await updatePasswordHash(user.id, "new-hash");
    const credentials = await findUserCredentials("a@example.com");
    expect(credentials?.passwordHash).toBe("new-hash");
  });

  it("rejects a gender outside the allowed set", async () => {
    await expect(
      createUser({
        name: "X",
        // Bypasses the schema to prove the database is a second line of defence.
        gender: "hacker" as never,
        email: "b@example.com",
        passwordHash: "h",
      }),
    ).rejects.toBeTruthy();
  });
});

describe("tokens", () => {
  it("stores only the hash and redeems the raw token once", async () => {
    const user = await makeUser();
    const issued = createToken(60_000);
    await storeToken("verification", user.id, issued.tokenHash, issued.expiresAt);

    const stored = await db.query<{ token_hash: string }>(
      "SELECT token_hash FROM email_verification_tokens",
    );
    expect(stored.rows[0].token_hash).toBe(hashToken(issued.token));
    expect(stored.rows[0].token_hash).not.toBe(issued.token);

    expect(await redeemToken("verification", issued.token)).toBe(user.id);
    // Single use: the second attempt finds nothing to update.
    expect(await redeemToken("verification", issued.token)).toBeNull();
  });

  it("refuses an expired token", async () => {
    const user = await makeUser();
    const issued = createToken(-1_000);
    await storeToken("reset", user.id, issued.tokenHash, issued.expiresAt);
    expect(await redeemToken("reset", issued.token)).toBeNull();
  });

  it("refuses an unknown token", async () => {
    expect(await redeemToken("verification", "not-a-real-token")).toBeNull();
  });

  it("invalidates outstanding tokens when a new one supersedes them", async () => {
    const user = await makeUser();
    const first = createToken(60_000);
    await storeToken("reset", user.id, first.tokenHash, first.expiresAt);

    await consumeAllTokens("reset", user.id);
    expect(await redeemToken("reset", first.token)).toBeNull();
  });

  it("counts recent issuance for rate limiting", async () => {
    const user = await makeUser();
    for (let i = 0; i < 3; i += 1) {
      const issued = createToken(60_000);
      await storeToken("verification", user.id, issued.tokenHash, issued.expiresAt);
    }
    const since = new Date(Date.now() - 60_000);
    expect(await countRecentTokens("verification", user.id, since)).toBe(3);
  });
});

describe("tracker data isolation", () => {
  const budgetInput = {
    name: "August",
    amount: 5_000,
    startDate: "2026-08-01",
    endDate: "2026-08-05",
  };

  it("keeps each user's budgets separate", async () => {
    const alice = await makeUser("alice@example.com");
    const bob = await makeUser("bob@example.com");

    await insertBudget(alice.id, budgetInput);

    expect(await listBudgets(alice.id)).toHaveLength(1);
    expect(await listBudgets(bob.id)).toHaveLength(0);
  });

  it("refuses to update another user's budget", async () => {
    const alice = await makeUser("alice@example.com");
    const bob = await makeUser("bob@example.com");
    const budget = await insertBudget(alice.id, budgetInput);

    // Bob knows the id and asks for it directly.
    const result = await updateBudgetRow(bob.id, budget.id, {
      ...budgetInput,
      amount: 1,
    });
    expect(result).toBeNull();

    const [unchanged] = await listBudgets(alice.id);
    expect(unchanged.amount).toBe(5_000);
  });

  it("refuses to delete another user's budget", async () => {
    const alice = await makeUser("alice@example.com");
    const bob = await makeUser("bob@example.com");
    const budget = await insertBudget(alice.id, budgetInput);

    expect(await deleteBudgetRow(bob.id, budget.id)).toBe(false);
    expect(await listBudgets(alice.id)).toHaveLength(1);
  });

  it("refuses to attach an expense to another user's budget", async () => {
    const alice = await makeUser("alice@example.com");
    const bob = await makeUser("bob@example.com");
    const budget = await insertBudget(alice.id, budgetInput);

    const result = await insertExpense(bob.id, {
      budgetId: budget.id,
      name: "Sneaky",
      amount: 100,
      expenseDate: "2026-08-02",
    });
    expect(result).toBeNull();
    expect(await listExpenses(alice.id)).toHaveLength(0);
  });

  it("refuses to update or delete another user's expense", async () => {
    const alice = await makeUser("alice@example.com");
    const bob = await makeUser("bob@example.com");
    const budget = await insertBudget(alice.id, budgetInput);
    const expense = await insertExpense(alice.id, {
      budgetId: budget.id,
      name: "Food",
      amount: 500,
      expenseDate: "2026-08-02",
    });

    const bobBudget = await insertBudget(bob.id, {
      ...budgetInput,
      name: "Bob's",
    });

    expect(
      await updateExpenseRow(bob.id, expense!.id, {
        budgetId: bobBudget.id,
        name: "Stolen",
        amount: 1,
        expenseDate: "2026-08-02",
      }),
    ).toBeNull();

    expect(await deleteExpenseRow(bob.id, expense!.id)).toBe(false);

    const [still] = await listExpenses(alice.id);
    expect(still.name).toBe("Food");
  });

  it("round-trips money through centavos without drift", async () => {
    const user = await makeUser();
    const budget = await insertBudget(user.id, { ...budgetInput, amount: 1_234.56 });
    expect(budget.amount).toBe(1_234.56);

    for (let i = 0; i < 10; i += 1) {
      await insertExpense(user.id, {
        budgetId: budget.id,
        name: `Coffee ${i}`,
        amount: 0.1,
        expenseDate: "2026-08-02",
      });
    }
    const expenses = await listExpenses(user.id);
    const total = expenses.reduce((sum, e) => sum + Math.round(e.amount * 100), 0);
    expect(total / 100).toBe(1);
  });

  it("loads a user's whole tracker in one call", async () => {
    const user = await makeUser();
    const budget = await insertBudget(user.id, budgetInput);
    await insertExpense(user.id, {
      budgetId: budget.id,
      name: "Food",
      amount: 500,
      expenseDate: "2026-08-02",
    });

    const data = await loadTrackerData(user.id);
    expect(data.budgets).toHaveLength(1);
    expect(data.expenses).toHaveLength(1);
  });

  it("removes a budget's expenses along with it", async () => {
    const user = await makeUser();
    const budget = await insertBudget(user.id, budgetInput);
    await insertExpense(user.id, {
      budgetId: budget.id,
      name: "Food",
      amount: 500,
      expenseDate: "2026-08-02",
    });

    await deleteBudgetRow(user.id, budget.id);
    expect(await listExpenses(user.id)).toHaveLength(0);
  });

  it("rejects a reversed budget period at the database level", async () => {
    const user = await makeUser();
    await expect(
      insertBudget(user.id, {
        name: "Backwards",
        amount: 10,
        startDate: "2026-08-05",
        endDate: "2026-08-01",
      }),
    ).rejects.toBeTruthy();
  });
});
