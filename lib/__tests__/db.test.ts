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
  budgetTotals,
  budgetTotalsBefore,
  listExpensesPage,
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
import { normalizeEmail } from "@/lib/auth/schemas";

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

describe("budget allotments without a date restriction", () => {
  const general = {
    name: "Emergency Fund",
    amount: 10_000,
    startDate: null,
    endDate: null,
  };

  it("stores and returns two nulls, not sentinel dates", async () => {
    const user = await makeUser();
    const budget = await insertBudget(user.id, general);

    expect(budget.startDate).toBeNull();
    expect(budget.endDate).toBeNull();

    const [reloaded] = await listBudgets(user.id);
    expect(reloaded.startDate).toBeNull();
    expect(reloaded.endDate).toBeNull();
    expect(reloaded.amount).toBe(10_000);
  });

  it("refuses a half-set period", async () => {
    // One end without the other is not a period, and every read path would
    // treat the row as unrestricted — silently dropping the date the user set.
    const user = await makeUser();

    await expect(
      insertBudget(user.id, { ...general, startDate: "2026-08-01", endDate: null }),
    ).rejects.toBeTruthy();

    await expect(
      insertBudget(user.id, { ...general, startDate: null, endDate: "2026-08-05" }),
    ).rejects.toBeTruthy();
  });

  it("lists dated allotments before undated ones", async () => {
    const user = await makeUser();
    await insertBudget(user.id, general);
    await insertBudget(user.id, {
      name: "August",
      amount: 5_000,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });

    expect((await listBudgets(user.id)).map((b) => b.name)).toEqual([
      "August",
      "Emergency Fund",
    ]);
  });

  it("converts a dated allotment to a general one and back", async () => {
    const user = await makeUser();
    const budget = await insertBudget(user.id, {
      name: "August",
      amount: 5_000,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });

    const relaxed = await updateBudgetRow(user.id, budget.id, {
      name: "August",
      amount: 5_000,
      startDate: null,
      endDate: null,
    });
    expect(relaxed?.startDate).toBeNull();

    const restored = await updateBudgetRow(user.id, budget.id, {
      name: "August",
      amount: 5_000,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    expect(restored?.startDate).toBe("2026-08-01");
    expect(restored?.endDate).toBe("2026-08-05");
  });

  it("funds an expense on any date", async () => {
    const user = await makeUser();
    const fund = await insertBudget(user.id, general);

    for (const date of ["2026-08-03", "2026-12-25", "2027-01-01"]) {
      const recorded = await insertExpense(user.id, {
        budgetId: fund.id,
        name: "Medicine",
        amount: 100,
        expenseDate: date,
      });
      expect(recorded?.budgetId).toBe(fund.id);
    }

    expect(await listExpenses(user.id)).toHaveLength(3);
  });
});

describe("moving an expense between allotments", () => {
  async function twoBudgets() {
    const user = await makeUser();
    const food = await insertBudget(user.id, {
      name: "Food Budget",
      amount: 5_000,
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    const fund = await insertBudget(user.id, {
      name: "Emergency Fund",
      amount: 10_000,
      startDate: null,
      endDate: null,
    });
    return { user, food, fund };
  }

  it("reverses the old deduction and applies the new one in one write", async () => {
    const { user, food, fund } = await twoBudgets();

    const recorded = await insertExpense(user.id, {
      budgetId: food.id,
      name: "Groceries",
      amount: 500,
      expenseDate: "2026-08-03",
    });

    const moved = await updateExpenseRow(user.id, recorded!.id, {
      budgetId: fund.id,
      name: "Groceries",
      amount: 500,
      expenseDate: "2026-08-03",
    });
    expect(moved?.budgetId).toBe(fund.id);

    // The expense exists exactly once, charged to exactly one allotment: it is
    // a single UPDATE, so it can neither hit both pots nor fall out of both.
    const expenses = await listExpenses(user.id);
    expect(expenses).toHaveLength(1);
    expect(expenses.filter((e) => e.budgetId === food.id)).toHaveLength(0);
    expect(expenses.filter((e) => e.budgetId === fund.id)).toHaveLength(1);
  });

  it("refuses to move an expense onto another account's budget", async () => {
    const { user, food } = await twoBudgets();
    const mallory = await makeUser("mallory@example.com");
    const theirs = await insertBudget(mallory.id, {
      name: "Their Budget",
      amount: 9_000,
      startDate: null,
      endDate: null,
    });

    const recorded = await insertExpense(user.id, {
      budgetId: food.id,
      name: "Groceries",
      amount: 500,
      expenseDate: "2026-08-03",
    });

    expect(
      await updateExpenseRow(user.id, recorded!.id, {
        budgetId: theirs.id,
        name: "Groceries",
        amount: 500,
        expenseDate: "2026-08-03",
      }),
    ).toBeNull();

    // Untouched, and still on the original allotment.
    const [unchanged] = await listExpenses(user.id);
    expect(unchanged.budgetId).toBe(food.id);
  });

  it("refuses to create an expense on another account's budget", async () => {
    const { user } = await twoBudgets();
    const mallory = await makeUser("mallory@example.com");
    const theirs = await insertBudget(mallory.id, {
      name: "Their Budget",
      amount: 9_000,
      startDate: null,
      endDate: null,
    });

    expect(
      await insertExpense(user.id, {
        budgetId: theirs.id,
        name: "Sneaky",
        amount: 100,
        expenseDate: "2026-08-03",
      }),
    ).toBeNull();
    expect(await listExpenses(mallory.id)).toHaveLength(0);
  });

  it("loads budgets and expenses together for one user only", async () => {
    const { user, fund } = await twoBudgets();
    await insertExpense(user.id, {
      budgetId: fund.id,
      name: "Medicine",
      amount: 1_000,
      expenseDate: "2026-09-01",
    });

    const data = await loadTrackerData(user.id);
    expect(data.budgets).toHaveLength(2);
    expect(data.expenses).toHaveLength(1);
    expect(data.expenses[0].budgetId).toBe(fund.id);
  });
});

describe("email uniqueness", () => {
  const base = {
    name: "Test User",
    gender: "prefer_not_to_say" as const,
    passwordHash: "hash-placeholder",
  };

  it("accepts a new address", async () => {
    const user = await createUser({ ...base, email: "new@example.com" });
    expect(user.email).toBe("new@example.com");
  });

  it("rejects the same address twice", async () => {
    await createUser({ ...base, email: "taken@example.com" });
    await expect(
      createUser({ ...base, email: "taken@example.com" }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it("rejects a differently-cased duplicate once normalized", async () => {
    // Callers normalize before reaching the database; the stored value is
    // always lowercase, so the unique index is what makes the comparison
    // case-insensitive.
    const first = normalizeEmail("  JOHN.DOE@Example.COM ");
    const second = normalizeEmail("john.doe@example.com");
    expect(first).toBe(second);

    await createUser({ ...base, email: first });
    await expect(
      createUser({ ...base, email: second }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it("finds an account whatever casing the lookup uses", async () => {
    await createUser({ ...base, email: normalizeEmail("Mixed.Case@Example.com") });
    const found = await findUserByEmail(normalizeEmail("MIXED.CASE@EXAMPLE.COM"));
    expect(found?.email).toBe("mixed.case@example.com");
  });

  it("does not treat dots or plus-addressing as the same account", async () => {
    // Deliberate: those are provider-specific conventions, and collapsing them
    // would merge addresses that some hosts genuinely treat as distinct.
    await createUser({ ...base, email: "john.doe@example.com" });
    const plus = await createUser({ ...base, email: "john.doe+budget@example.com" });
    expect(plus.email).toBe("john.doe+budget@example.com");
  });

  it("lets the database settle concurrent registrations of one address", async () => {
    /*
     * The important case. An application-level "does it exist?" check cannot
     * prevent this: both requests can pass the SELECT before either INSERTs.
     * The unique index is the only thing that decides, so exactly one of these
     * must win and the rest must fail as duplicates.
     */
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createUser({ ...base, email: "race@example.com" }),
      ),
    );

    const created = attempts.filter((a) => a.status === "fulfilled");
    const refused = attempts.filter(
      (a) =>
        a.status === "rejected" &&
        a.reason instanceof EmailAlreadyRegisteredError,
    );

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(4);

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users WHERE email = 'race@example.com'`,
    );
    expect(rows[0].count).toBe("1");
  });
});

describe("paged expenses", () => {
  async function seed(count: number) {
    const user = await makeUser();
    const budget = await insertBudget(user.id, {
      name: "August",
      amount: 100_000,
      startDate: null,
      endDate: null,
    });
    const other = await insertBudget(user.id, {
      name: "Other",
      amount: 100_000,
      startDate: null,
      endDate: null,
    });

    for (let index = 0; index < count; index += 1) {
      const day = String((index % 28) + 1).padStart(2, "0");
      await insertExpense(user.id, {
        budgetId: index % 5 === 0 ? other.id : budget.id,
        name: `Expense ${index + 1}`,
        amount: index + 1,
        expenseDate: `2026-08-${day}`,
      });
    }

    return { user, budget, other };
  }

  it("returns one page and the numbers describing it", async () => {
    const { user } = await seed(45);
    const page = await listExpensesPage(user.id, { page: 2, pageSize: 20 });

    expect(page.data).toHaveLength(20);
    expect(page.pagination).toMatchObject({
      page: 2,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
      firstItem: 21,
      lastItem: 40,
    });
  });

  it("returns a short final page", async () => {
    const { user } = await seed(45);
    const page = await listExpensesPage(user.id, { page: 3, pageSize: 20 });
    expect(page.data).toHaveLength(5);
    expect(page.pagination.hasNext).toBe(false);
  });

  it("pulls a page beyond the end back into range", async () => {
    const { user } = await seed(10);
    const page = await listExpensesPage(user.id, { page: 9, pageSize: 20 });
    expect(page.pagination.page).toBe(1);
    expect(page.data).toHaveLength(10);
  });

  it("caps an absurd page size instead of reading the table", async () => {
    const { user } = await seed(5);
    const page = await listExpensesPage(user.id, { pageSize: 100_000 });
    expect(page.pagination.pageSize).toBe(100);
  });

  it("sorts across the whole set, not within a page", async () => {
    const { user } = await seed(45);
    // Amounts are 1..45, so the very largest must lead page 1 under "highest".
    const highest = await listExpensesPage(user.id, { sort: "highest", pageSize: 5 });
    expect(highest.data.map((e) => e.amount)).toEqual([45, 44, 43, 42, 41]);

    const lowest = await listExpensesPage(user.id, { sort: "lowest", pageSize: 5 });
    expect(lowest.data.map((e) => e.amount)).toEqual([1, 2, 3, 4, 5]);
  });

  it("pages a sort without repeating or dropping a row", async () => {
    const { user } = await seed(45);
    const seen = new Set<string>();

    for (let page = 1; page <= 3; page += 1) {
      const result = await listExpensesPage(user.id, {
        page,
        pageSize: 20,
        sort: "newest",
      });
      for (const expense of result.data) seen.add(expense.id);
    }

    expect(seen.size).toBe(45);
  });

  it("filters by budget and re-counts for that filter", async () => {
    const { user, other } = await seed(45);
    const page = await listExpensesPage(user.id, { budgetId: other.id, pageSize: 50 });

    expect(page.data.every((e) => e.budgetId === other.id)).toBe(true);
    expect(page.pagination.totalItems).toBe(9);
    expect(page.pagination.totalPages).toBe(1);
  });

  it("filters by date range", async () => {
    const { user } = await seed(45);
    const page = await listExpensesPage(user.id, {
      from: "2026-08-01",
      to: "2026-08-03",
      pageSize: 100,
    });

    expect(page.data.every((e) => e.expenseDate <= "2026-08-03")).toBe(true);
    expect(page.pagination.totalItems).toBe(page.data.length);
  });

  it("never returns another account's expenses", async () => {
    const { user } = await seed(10);
    const stranger = await makeUser("stranger@example.com");

    const mine = await listExpensesPage(user.id, { pageSize: 100 });
    const theirs = await listExpensesPage(stranger.id, { pageSize: 100 });

    expect(mine.pagination.totalItems).toBe(10);
    expect(theirs.pagination.totalItems).toBe(0);
    expect(theirs.data).toEqual([]);
  });
});

describe("budget aggregates", () => {
  it("sums each budget's spend in the database", async () => {
    const user = await makeUser();
    const a = await insertBudget(user.id, {
      name: "A",
      amount: 5_000,
      startDate: null,
      endDate: null,
    });
    const b = await insertBudget(user.id, {
      name: "B",
      amount: 5_000,
      startDate: null,
      endDate: null,
    });

    for (const [budgetId, amount, date] of [
      [a.id, 500, "2026-08-01"],
      [a.id, 250.5, "2026-08-02"],
      [b.id, 1_000, "2026-08-02"],
    ] as const) {
      await insertExpense(user.id, { budgetId, name: "x", amount, expenseDate: date });
    }

    const totals = await budgetTotals(user.id);
    const forA = totals.find((t) => t.budgetId === a.id)!;
    const forB = totals.find((t) => t.budgetId === b.id)!;

    expect(forA.totalExpenses).toBe(750.5);
    expect(forA.expenseCount).toBe(2);
    expect(forB.totalExpenses).toBe(1_000);
  });

  it("reports only what was spent before a date", async () => {
    const user = await makeUser();
    const budget = await insertBudget(user.id, {
      name: "A",
      amount: 5_000,
      startDate: null,
      endDate: null,
    });

    for (const [amount, date] of [
      [100, "2026-07-30"],
      [200, "2026-07-31"],
      [400, "2026-08-01"],
    ] as const) {
      await insertExpense(user.id, {
        budgetId: budget.id,
        name: "x",
        amount,
        expenseDate: date,
      });
    }

    // Strictly before, so August's own spending is excluded.
    const before = await budgetTotalsBefore(user.id, "2026-08-01");
    expect(before.find((t) => t.budgetId === budget.id)?.totalExpenses).toBe(300);
  });

  it("counts nothing for an account with no expenses", async () => {
    const user = await makeUser();
    expect(await budgetTotals(user.id)).toEqual([]);
  });
});
