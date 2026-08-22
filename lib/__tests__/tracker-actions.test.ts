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
  createTransferAction,
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

/* --------------------------------------------------------------- transfers */

const GENERAL = { startDate: null, endDate: null } as const;

/** Signs in with one allotment holding `amount`. */
async function withBudget(amount = 10_000, name = "Main Budget") {
  await signIn();
  return unwrap(await createBudgetAction({ name, amount, ...GENERAL }));
}

describe("moving money through the actions", () => {
  it("deducts the source and hands back the new allotment", async () => {
    const main = await withBudget();

    const write = unwrap(
      await createTransferAction({
        sourceBudgetId: main.id,
        amount: 2_000,
        expenseDate: "2026-08-22",
        name: "Emergency Fund",
        ...GENERAL,
      }),
    );

    expect(write.destination.name).toBe("Emergency Fund");
    expect(write.destination.allocationType).toBe("transferred");
    expect(write.destination.sourceBudgetId).toBe(main.id);
    expect(write.transfer.kind).toBe("transfer");
    // All three come back because the screen has to update all three.
    expect(write.source.id).toBe(main.id);
  });

  it("refuses to move more than the source holds", async () => {
    const main = await withBudget(1_000);

    const refused = await createTransferAction({
      sourceBudgetId: main.id,
      amount: 1_500,
      expenseDate: "2026-08-22",
      name: "Emergency Fund",
      ...GENERAL,
    });

    expect(errorOf(refused)).toMatch(/exceeds this budget's available balance/i);
    // Nothing partial: the destination must not exist.
    expect(unwrap(await listBudgetsAction())).toHaveLength(1);
  });

  it("requires a name for the new allotment", async () => {
    const main = await withBudget();

    const refused = await createTransferAction({
      sourceBudgetId: main.id,
      amount: 2_000,
      expenseDate: "2026-08-22",
      name: "   ",
      ...GENERAL,
    });

    expect(errorOf(refused)).toMatch(/give this budget a name/i);
  });

  it("rejects a zero or negative amount", async () => {
    const main = await withBudget();

    for (const amount of [0, -100]) {
      const refused = await createTransferAction({
        sourceBudgetId: main.id,
        amount,
        expenseDate: "2026-08-22",
        name: "Emergency Fund",
        ...GENERAL,
      });
      expect(errorOf(refused)).toMatch(/greater than zero/i);
    }
  });

  it("rejects a reversed date range for the new allotment", async () => {
    const main = await withBudget();

    const refused = await createTransferAction({
      sourceBudgetId: main.id,
      amount: 2_000,
      expenseDate: "2026-08-22",
      name: "Travel Fund",
      startDate: "2026-08-30",
      endDate: "2026-08-25",
    });

    expect(errorOf(refused)).toBeTruthy();
    expect(unwrap(await listBudgetsAction())).toHaveLength(1);
  });

  it("refuses a fully spent source", async () => {
    const main = await withBudget(1_000);
    unwrap(
      await createExpenseAction({
        budgetId: main.id,
        name: "Everything",
        amount: 1_000,
        expenseDate: "2026-08-22",
      }),
    );

    const refused = await createTransferAction({
      sourceBudgetId: main.id,
      amount: 1,
      expenseDate: "2026-08-22",
      name: "Emergency Fund",
      ...GENERAL,
    });

    expect(errorOf(refused)).toMatch(/fully spent/i);
  });

  it("refuses another account's budget as a source", async () => {
    const main = await withBudget();

    // A crafted request naming someone else's budget id, with no UI involved.
    // The intruder has an allotment of their own, so the refusal is about the
    // id they submitted rather than about having nothing at all.
    await withBudget(5_000, "Their Own Budget");
    const refused = await createTransferAction({
      sourceBudgetId: main.id,
      amount: 100,
      expenseDate: "2026-08-22",
      name: "Stolen Fund",
      ...GENERAL,
    });

    expect(errorOf(refused)).toMatch(/not available for the selected date/i);
    // Still one allotment: their own. Nothing was created, nothing was moved.
    expect(unwrap(await listBudgetsAction())).toHaveLength(1);
  });

  it("refuses an unauthenticated transfer", async () => {
    const main = await withBudget();
    callerId = null;

    const refused = await createTransferAction({
      sourceBudgetId: main.id,
      amount: 100,
      expenseDate: "2026-08-22",
      name: "Emergency Fund",
      ...GENERAL,
    });

    expect(errorOf(refused)).toMatch(/log in again/i);
  });

  it("closes the source when the transfer takes its whole balance", async () => {
    const main = await withBudget(2_000);

    const write = unwrap(
      await createTransferAction({
        sourceBudgetId: main.id,
        amount: 2_000,
        expenseDate: "2026-08-22",
        name: "Emergency Fund",
        ...GENERAL,
      }),
    );

    expect(write.source.status).toBe("fully_spent");
    expect(write.destination.status).toBe("active");
  });
});

describe("a committed transfer through the actions", () => {
  async function moved() {
    const main = await withBudget();
    const write = unwrap(
      await createTransferAction({
        sourceBudgetId: main.id,
        amount: 2_000,
        expenseDate: "2026-08-22",
        name: "Emergency Fund",
        ...GENERAL,
      }),
    );
    return { main, ...write };
  }

  it("cannot be edited as an expense", async () => {
    const { main, transfer } = await moved();

    const refused = await updateExpenseAction(transfer.id, {
      budgetId: main.id,
      name: "Rewritten",
      amount: 1,
      expenseDate: "2026-08-22",
    });

    expect(errorOf(refused)).toMatch(/budget transfer/i);
  });

  it("cannot be deleted", async () => {
    const { transfer } = await moved();
    expect(errorOf(await deleteExpenseAction(transfer.id))).toMatch(
      /budget transfer/i,
    );
  });

  it("fixes the destination's amount", async () => {
    const { destination } = await moved();

    const refused = await updateBudgetAction(destination.id, {
      name: "Emergency Fund",
      amount: 9_999,
      ...GENERAL,
    });

    expect(errorOf(refused)).toMatch(/budget transfer/i);
  });

  it("stops the source being deleted", async () => {
    const { main } = await moved();
    expect(errorOf(await deleteBudgetAction(main.id))).toMatch(
      /funded another allotment/i,
    );
  });

  it("stops the destination being deleted", async () => {
    const { destination } = await moved();
    expect(errorOf(await deleteBudgetAction(destination.id))).toMatch(
      /budget transfer/i,
    );
  });
});
