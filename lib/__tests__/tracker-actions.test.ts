/**
 * The server actions as an attacker reaches them.
 *
 * The screens hide Edit, Delete and Unlock for a fully spent budget, but hiding
 * a control is a courtesy, not a rule. These tests call the actions directly —
 * the same entry point a crafted request reaches with no UI involved — and
 * check that each one refuses on its own.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/db";

/** The session is the only source of identity; the tests choose who is calling. */
let callerId: string | null = null;

vi.mock("@/lib/server/session", () => ({
  getUserId: async () => callerId,
  requireUserId: async () => callerId,
  currentUser: async () => (callerId ? { id: callerId } : null),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  createBudgetAction,
  createExpenseAction,
  deleteBudgetAction,
  deleteExpenseAction,
  listBudgetsAction,
  setBudgetLockedAction,
  updateBudgetAction,
  updateExpenseAction,
} = await import("@/lib/server/tracker-actions");

const { createUser } = await import("@/lib/db/users");

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.reset();
  callerId = null;
});

let seq = 0;

async function signIn() {
  seq += 1;
  const user = await createUser({
    name: "Test User",
    gender: "prefer_not_to_say",
    email: `caller${seq}@example.com`,
    passwordHash: "hash-placeholder",
  });
  callerId = user.id;
  return user;
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected success, got "${result.error}"`);
  return result.data;
}

function errorOf(result: { ok: boolean; error?: string }): string {
  if (result.ok) throw new Error("expected the request to be refused");
  return result.error!;
}

/** Signs in, allots `amount`, and spends every centavo of it. */
async function closedBudget(amount = 1_000) {
  await signIn();
  const budget = unwrap(
    await createBudgetAction({
      name: "Food",
      amount,
      startDate: null,
      endDate: null,
    }),
  );

  const write = unwrap(
    await createExpenseAction({
      budgetId: budget.id,
      name: "Everything",
      amount,
      expenseDate: "2026-08-03",
    }),
  );

  expect(write.budget.status).toBe("fully_spent");
  return { budget: write.budget, expense: write.expense };
}

describe("completing a budget through the actions", () => {
  it("closes it and says so in the response", async () => {
    const { budget } = await closedBudget();
    expect(budget.completedAt).not.toBeNull();
  });

  it("refuses an expense that would overspend, with the balance left", async () => {
    await signIn();
    const budget = unwrap(
      await createBudgetAction({
        name: "Food",
        amount: 1_000,
        startDate: null,
        endDate: null,
      }),
    );

    const refused = await createExpenseAction({
      budgetId: budget.id,
      name: "Too much",
      amount: 1_500,
      expenseDate: "2026-08-03",
    });

    expect(errorOf(refused)).toMatch(/exceeds this budget's available balance/i);
  });
});

describe("a closed budget refuses every write", () => {
  it("refuses an edit", async () => {
    const { budget } = await closedBudget();

    const refused = await updateBudgetAction(budget.id, {
      name: "Reopened",
      amount: 99_999,
      startDate: null,
      endDate: null,
    });

    expect(errorOf(refused)).toMatch(/fully spent/i);
    expect(unwrap(await listBudgetsAction())[0].amount).toBe(1_000);
  });

  it("refuses a delete", async () => {
    const { budget } = await closedBudget();

    expect(errorOf(await deleteBudgetAction(budget.id))).toMatch(/fully spent/i);
    expect(unwrap(await listBudgetsAction())).toHaveLength(1);
  });

  it("refuses an unlock", async () => {
    const { budget } = await closedBudget();

    // There is no unlock. The action that toggles the manual lock has no power
    // over a budget closed by its lifecycle.
    expect(errorOf(await setBudgetLockedAction(budget.id, false))).toMatch(
      /fully spent/i,
    );
    expect(unwrap(await listBudgetsAction())[0].locked).toBe(true);
  });

  it("refuses a new expense against it", async () => {
    const { budget } = await closedBudget();

    const refused = await createExpenseAction({
      budgetId: budget.id,
      name: "One more",
      amount: 0.01,
      expenseDate: "2026-08-04",
    });

    expect(errorOf(refused)).toMatch(/fully spent/i);
  });
});

describe("a closed budget's expenses refuse every write", () => {
  it("refuses an edit", async () => {
    const { budget, expense } = await closedBudget();

    const refused = await updateExpenseAction(expense.id, {
      budgetId: budget.id,
      name: "Rewritten",
      amount: 1,
      expenseDate: "2026-08-03",
    });

    expect(errorOf(refused)).toMatch(/fully spent/i);
  });

  it("refuses a move to another allotment", async () => {
    const { expense } = await closedBudget();
    const elsewhere = unwrap(
      await createBudgetAction({
        name: "Emergency",
        amount: 9_000,
        startDate: null,
        endDate: null,
      }),
    );

    const refused = await updateExpenseAction(expense.id, {
      budgetId: elsewhere.id,
      name: "Everything",
      amount: 1_000,
      expenseDate: "2026-08-03",
    });

    expect(errorOf(refused)).toMatch(/fully spent/i);
  });

  it("refuses a delete", async () => {
    const { expense } = await closedBudget();
    expect(errorOf(await deleteExpenseAction(expense.id))).toMatch(/fully spent/i);
  });
});

describe("creating budgets is unaffected", () => {
  it("still works once an allotment has been closed", async () => {
    await closedBudget();

    const fresh = unwrap(
      await createBudgetAction({
        name: "September",
        amount: 4_000,
        startDate: null,
        endDate: null,
      }),
    );

    expect(fresh.status).toBe("active");
    expect(unwrap(await listBudgetsAction())).toHaveLength(2);
  });
});

describe("another account's closed budget", () => {
  it("is not found rather than reported as locked", async () => {
    const { budget } = await closedBudget();

    // Signing in as someone else must not confirm the budget exists.
    await signIn();
    expect(errorOf(await deleteBudgetAction(budget.id))).toMatch(/not found/i);
    expect(unwrap(await listBudgetsAction())).toHaveLength(0);
  });
});

describe("an unauthenticated caller", () => {
  it("cannot write at all", async () => {
    const { budget, expense } = await closedBudget();
    callerId = null;

    for (const refused of [
      await updateBudgetAction(budget.id, {
        name: "x",
        amount: 1,
        startDate: null,
        endDate: null,
      }),
      await deleteBudgetAction(budget.id),
      await deleteExpenseAction(expense.id),
    ]) {
      expect(errorOf(refused)).toMatch(/log in again/i);
    }
  });
});
