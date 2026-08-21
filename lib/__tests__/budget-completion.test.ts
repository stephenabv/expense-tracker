/**
 * Fully spent budgets: completion, locking, and the archive.
 *
 * The rule these tests protect is that a budget spent down to exactly ₱0.00
 * becomes a closed record — it and its expenses stop being editable, and no
 * request can reopen them. Everything here runs against real Postgres (PGlite),
 * because the enforcement lives in the SQL: the WHERE clauses, the row lock and
 * the transaction are the mechanism, so a test against a fake would be checking
 * nothing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/db";
import { getDatabase, type SqlExecutor } from "@/lib/db/client";
import { createUser } from "@/lib/db/users";
import {
  budgetTotals,
  deleteBudgetRow,
  deleteExpenseRow,
  insertBudget,
  insertExpense,
  listBudgets,
  listExpenses,
  setBudgetLockedRow,
  updateBudgetRow,
  updateExpenseRow,
} from "@/lib/db/tracker";
import {
  activeBudgets,
  budgetStatus,
  budgetsForDate,
  completedBudgets,
  generalBudgets,
  isActive,
  isFullySpent,
  summarizeBudgetsFromTotals,
  STATUS_LABELS,
} from "@/lib/budgets";
import { buildHistory, summarizeHistory } from "@/lib/history";
import { budgetStatusLabel } from "@/lib/pdf/report";
import type { Budget } from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import { budget as makeBudget, completedBudget, expense } from "./helpers";

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

let seq = 0;

async function makeUser() {
  seq += 1;
  return createUser({
    name: "Test User",
    gender: "prefer_not_to_say",
    email: `owner${seq}@example.com`,
    passwordHash: "hash-placeholder",
  });
}

const GENERAL = { startDate: null, endDate: null } as const;

/** An open allotment with no date restriction, so any expense date qualifies. */
async function allotment(userId: string, amount: number, name = "Food") {
  return insertBudget(userId, { name, amount, ...GENERAL });
}

async function record(userId: string, input: ExpenseInput): Promise<Expense> {
  const result = await insertExpense(userId, input);
  if (!result.ok) throw new Error(`expected a write, got "${result.reason}"`);
  return result.expense;
}

/** Reads one budget back from the database. */
async function reload(userId: string, budgetId: string): Promise<Budget> {
  const found = (await listBudgets(userId)).find((entry) => entry.id === budgetId);
  if (!found) throw new Error("budget disappeared");
  return found;
}

/** A budget spent to exactly zero, plus the expense that closed it. */
async function spentOut(amount = 1_000) {
  const user = await makeUser();
  const budget = await allotment(user.id, amount);
  const last = await record(user.id, {
    budgetId: budget.id,
    name: "Everything",
    amount,
    expenseDate: "2026-08-03",
  });
  return { user, budget: await reload(user.id, budget.id), expense: last };
}

/* --------------------------------------------------------------- completion */

describe("reaching exactly zero", () => {
  it("closes the budget in the same write that spends the last centavo", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);

    const result = await insertExpense(user.id, {
      budgetId: budget.id,
      name: "Groceries",
      amount: 1_000,
      expenseDate: "2026-08-03",
    });

    // The response already carries the closed budget: the client never sees a
    // moment where the expense exists but the allotment still looks spendable.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.budget.status).toBe("fully_spent");
    expect(result.budget.completedAt).not.toBeNull();
    expect(result.budget.locked).toBe(true);

    const stored = await reload(user.id, budget.id);
    expect(stored.status).toBe("fully_spent");
  });

  it("closes it after a series of expenses, not only a single one", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);

    for (const amount of [400, 350]) {
      await record(user.id, {
        budgetId: budget.id,
        name: "Part",
        amount,
        expenseDate: "2026-08-03",
      });
      expect((await reload(user.id, budget.id)).status).toBe("active");
    }

    await record(user.id, {
      budgetId: budget.id,
      name: "Last",
      amount: 250,
      expenseDate: "2026-08-03",
    });
    expect((await reload(user.id, budget.id)).status).toBe("fully_spent");
  });

  it("leaves a budget with ₱1 left alone", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);

    await record(user.id, {
      budgetId: budget.id,
      name: "Groceries",
      amount: 999,
      expenseDate: "2026-08-03",
    });

    const stored = await reload(user.id, budget.id);
    expect(stored.status).toBe("active");
    expect(stored.completedAt).toBeNull();
  });

  it("is exact to the centavo", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 100);

    await record(user.id, {
      budgetId: budget.id,
      name: "Almost",
      amount: 99.99,
      expenseDate: "2026-08-03",
    });
    expect((await reload(user.id, budget.id)).status).toBe("active");

    await record(user.id, {
      budgetId: budget.id,
      name: "The last centavo",
      amount: 0.01,
      expenseDate: "2026-08-03",
    });
    expect((await reload(user.id, budget.id)).status).toBe("fully_spent");
  });

  it("closes a budget when an edit brings the balance to zero", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);
    const recorded = await record(user.id, {
      budgetId: budget.id,
      name: "Groceries",
      amount: 600,
      expenseDate: "2026-08-03",
    });

    const edited = await updateExpenseRow(user.id, recorded.id, {
      budgetId: budget.id,
      name: "Groceries",
      amount: 1_000,
      expenseDate: "2026-08-03",
    });

    expect(edited.ok).toBe(true);
    expect((await reload(user.id, budget.id)).status).toBe("fully_spent");
  });

  it("closes a budget lowered to exactly what it has already spent", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);
    await record(user.id, {
      budgetId: budget.id,
      name: "Groceries",
      amount: 600,
      expenseDate: "2026-08-03",
    });

    const edited = await updateBudgetRow(user.id, budget.id, {
      name: "Food",
      amount: 600,
      ...GENERAL,
    });

    expect(edited.ok && edited.budget.status).toBe("fully_spent");
  });

  it("never closes a budget that has no expenses at all", async () => {
    const user = await makeUser();
    // Nothing was spent out here — the allotment is simply worth nothing yet,
    // and closing it would archive a budget the user has not used.
    const budget = await allotment(user.id, 0);
    expect((await reload(user.id, budget.id)).status).toBe("active");
  });
});

/* -------------------------------------------------- over-budget protection */

describe("over-budget protection", () => {
  it("refuses an expense larger than the remaining balance", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);

    const result = await insertExpense(user.id, {
      budgetId: budget.id,
      name: "Too much",
      amount: 1_000.01,
      expenseDate: "2026-08-03",
    });

    expect(result).toEqual({ ok: false, reason: "insufficient", remaining: 1_000 });
    expect(await listExpenses(user.id)).toHaveLength(0);
    // Nothing was written, so the budget is not accidentally closed either.
    expect((await reload(user.id, budget.id)).status).toBe("active");
  });

  it("reports what is actually left, not the full allotment", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 1_000);
    await record(user.id, {
      budgetId: budget.id,
      name: "Groceries",
      amount: 700,
      expenseDate: "2026-08-03",
    });

    const result = await insertExpense(user.id, {
      budgetId: budget.id,
      name: "Too much",
      amount: 400,
      expenseDate: "2026-08-03",
    });
    expect(result).toEqual({ ok: false, reason: "insufficient", remaining: 300 });
  });
});

/* ----------------------------------------------------- budget immutability */

describe("a fully spent budget", () => {
  it("cannot be edited", async () => {
    const { user, budget } = await spentOut();

    const result = await updateBudgetRow(user.id, budget.id, {
      name: "Renamed",
      amount: 99_999,
      ...GENERAL,
    });

    expect(result).toEqual({ ok: false, reason: "locked" });

    const unchanged = await reload(user.id, budget.id);
    expect(unchanged.name).toBe("Food");
    expect(unchanged.amount).toBe(1_000);
  });

  it("cannot be deleted", async () => {
    const { user, budget } = await spentOut();

    expect(await deleteBudgetRow(user.id, budget.id)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(await listBudgets(user.id)).toHaveLength(1);
  });

  it("cannot be unlocked", async () => {
    const { user, budget } = await spentOut();

    expect(await setBudgetLockedRow(user.id, budget.id, false)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect((await reload(user.id, budget.id)).locked).toBe(true);
  });

  it("cannot take another expense, however small", async () => {
    const { user, budget } = await spentOut();

    const result = await insertExpense(user.id, {
      budgetId: budget.id,
      name: "One more",
      amount: 0.01,
      expenseDate: "2026-08-04",
    });

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(await listExpenses(user.id)).toHaveLength(1);
  });

  it("stays closed even after its amount would allow more", async () => {
    const { user, budget } = await spentOut();

    // The edit is refused, so there is no path by which the stored status and
    // the arithmetic can disagree — the budget cannot be quietly reopened.
    await updateBudgetRow(user.id, budget.id, {
      name: "Food",
      amount: 5_000,
      ...GENERAL,
    });

    const stored = await reload(user.id, budget.id);
    expect(stored.amount).toBe(1_000);
    expect(stored.status).toBe("fully_spent");
  });
});

/* ---------------------------------------------------- expense immutability */

describe("an expense in a fully spent budget", () => {
  it("cannot have its amount changed", async () => {
    const { user, budget, expense: recorded } = await spentOut();

    const result = await updateExpenseRow(user.id, recorded.id, {
      budgetId: budget.id,
      name: "Everything",
      amount: 1,
      expenseDate: "2026-08-03",
    });

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect((await listExpenses(user.id))[0].amount).toBe(1_000);
  });

  it("cannot be renamed or re-dated", async () => {
    const { user, budget, expense: recorded } = await spentOut();

    expect(
      await updateExpenseRow(user.id, recorded.id, {
        budgetId: budget.id,
        name: "Something else",
        amount: 1_000,
        expenseDate: "2026-09-09",
      }),
    ).toEqual({ ok: false, reason: "locked" });

    const [unchanged] = await listExpenses(user.id);
    expect(unchanged.name).toBe("Everything");
    expect(unchanged.expenseDate).toBe("2026-08-03");
  });

  it("cannot be moved to another allotment", async () => {
    const { user, expense: recorded } = await spentOut();
    const elsewhere = await allotment(user.id, 9_000, "Emergency Fund");

    expect(
      await updateExpenseRow(user.id, recorded.id, {
        budgetId: elsewhere.id,
        name: "Everything",
        amount: 1_000,
        expenseDate: "2026-08-03",
      }),
    ).toEqual({ ok: false, reason: "locked" });

    expect((await listExpenses(user.id))[0].budgetId).not.toBe(elsewhere.id);
  });

  it("cannot be deleted", async () => {
    const { user, expense: recorded } = await spentOut();

    expect(await deleteExpenseRow(user.id, recorded.id)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(await listExpenses(user.id)).toHaveLength(1);
  });

  it("cannot be joined by an expense moved in from an open budget", async () => {
    const { user, budget } = await spentOut();
    const open = await allotment(user.id, 5_000, "Emergency Fund");
    const other = await record(user.id, {
      budgetId: open.id,
      name: "Medicine",
      amount: 100,
      expenseDate: "2026-08-04",
    });

    expect(
      await updateExpenseRow(user.id, other.id, {
        budgetId: budget.id,
        name: "Medicine",
        amount: 100,
        expenseDate: "2026-08-04",
      }),
    ).toEqual({ ok: false, reason: "locked" });

    expect((await listExpenses(user.id)).filter((e) => e.budgetId === budget.id))
      .toHaveLength(1);
  });
});

/* -------------------------------------------------------------- atomicity */

describe("atomicity", () => {
  it("writes nothing when the expense is refused", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 500);

    await insertExpense(user.id, {
      budgetId: budget.id,
      name: "Too much",
      amount: 600,
      expenseDate: "2026-08-03",
    });

    expect(await listExpenses(user.id)).toHaveLength(0);
    expect(await budgetTotals(user.id)).toEqual([]);
    expect((await reload(user.id, budget.id)).status).toBe("active");
  });

  it("rolls the expense back if the transaction fails after the insert", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 500);

    /*
     * Fails the statement that runs *after* the INSERT.
     *
     * If the insert and the completion check were separate operations the
     * expense would survive the failure and the budget would never be
     * re-evaluated — a row charged against a balance nobody checked. Inside one
     * transaction it has to vanish with the rest.
     */
    const real = getDatabase();
    const faulty: SqlExecutor = {
      query: <T,>(text: string, params?: unknown[]) => real.query<T>(text, params),
      transaction: (fn) =>
        real.transaction!(async (tx) => {
          let inserted = false;
          return fn({
            query: async <T,>(text: string, params?: unknown[]) => {
              if (inserted && /FROM budgets/i.test(text)) throw new Error("boom");
              const result = await tx.query<T>(text, params);
              if (/^\s*INSERT INTO expenses/i.test(text)) inserted = true;
              return result;
            },
          });
        }),
    };

    await expect(
      insertExpense(
        user.id,
        {
          budgetId: budget.id,
          name: "Groceries",
          amount: 500,
          expenseDate: "2026-08-03",
        },
        faulty,
      ),
    ).rejects.toThrow(/boom/);

    expect(await listExpenses(user.id)).toHaveLength(0);
    expect((await reload(user.id, budget.id)).status).toBe("active");
  });
});

/* ------------------------------------------------------------ concurrency */

describe("concurrent spending", () => {
  it("does not let two requests spend the same ₱500", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 500);

    const attempt = (name: string) =>
      insertExpense(user.id, {
        budgetId: budget.id,
        name,
        amount: 500,
        expenseDate: "2026-08-03",
      });

    // Both read a balance of ₱500 before either commits — the row lock is what
    // makes the second one re-read and find nothing left.
    const results = await Promise.all([attempt("First"), attempt("Second")]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);

    // Whichever request lost is refused — as "insufficient" if it re-read
    // first, or "locked" if the winner had already closed the budget. Either
    // way it does not write, which is the property that matters.
    const refused = results.find((result) => !result.ok)!;
    expect(!refused.ok && refused.reason).toMatch(/insufficient|locked/);

    expect(await listExpenses(user.id)).toHaveLength(1);
    expect((await reload(user.id, budget.id)).status).toBe("fully_spent");
  });

  it("refuses the loser for want of balance when the budget stays open", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 500);

    // 400 twice against 500: the first leaves ₱100, so the second is short
    // rather than locked out, and says so.
    const results = await Promise.all(
      ["First", "Second"].map((name) =>
        insertExpense(user.id, {
          budgetId: budget.id,
          name,
          amount: 400,
          expenseDate: "2026-08-03",
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      reason: "insufficient",
      remaining: 100,
    });
    expect((await reload(user.id, budget.id)).status).toBe("active");
  });

  it("admits exactly as many small expenses as the budget can pay for", async () => {
    const user = await makeUser();
    const budget = await allotment(user.id, 300);

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((index) =>
        insertExpense(user.id, {
          budgetId: budget.id,
          name: `Attempt ${index}`,
          amount: 100,
          expenseDate: "2026-08-03",
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(3);
    const [totals] = await budgetTotals(user.id);
    expect(totals.totalExpenses).toBe(300);
    expect((await reload(user.id, budget.id)).status).toBe("fully_spent");
  });
});

/* ------------------------------------------------------------ other users */

describe("ownership", () => {
  it("still refuses another account's closed budget as not-found, not locked", async () => {
    const { budget } = await spentOut();
    const intruder = await makeUser();

    // "Locked" would confirm the budget exists. A stranger learns nothing.
    expect(
      await insertExpense(intruder.id, {
        budgetId: budget.id,
        name: "Sneaky",
        amount: 1,
        expenseDate: "2026-08-04",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("lets the owner keep creating new budgets afterwards", async () => {
    const { user } = await spentOut();

    const fresh = await allotment(user.id, 2_000, "September");
    expect(fresh.status).toBe("active");
    expect((await listBudgets(user.id)).filter(isFullySpent)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ domain rules */

describe("domain rules", () => {
  const open = makeBudget("b1", "Open", 1_000, null);
  const closed = completedBudget("b2", "Closed", 1_000, null);

  it("never offers a closed allotment for a new expense", () => {
    expect(budgetsForDate([open, closed], "2026-08-03").map((b) => b.id)).toEqual([
      "b1",
    ]);
    expect(generalBudgets([open, closed]).map((b) => b.id)).toEqual(["b1"]);
    expect(isActive(closed)).toBe(false);
  });

  it("reports the closed status above every other", () => {
    // Overspent arithmetic must not talk over the lifecycle: the budget is
    // closed, and that is the only thing the badge should say.
    const overspent = completedBudget("b3", "Closed", 100, null);
    const charged = [expense("e1", "b3", "Big", 500, "2026-08-03")];
    expect(budgetStatus(overspent, charged)).toBe("fully-spent");
    expect(STATUS_LABELS["fully-spent"]).toBe("Fully Spent");
  });

  it("splits the two lists apart", () => {
    expect(activeBudgets([open, closed]).map((b) => b.id)).toEqual(["b1"]);
    expect(completedBudgets([open, closed]).map((b) => b.id)).toEqual(["b2"]);
  });

  it("carries the status into the summary the screens render", () => {
    const [first, second] = summarizeBudgetsFromTotals(
      [open, closed],
      [{ budgetId: "b2", totalExpenses: 1_000, expenseCount: 1 }],
    );
    expect(first.status).toBe("unrestricted");
    expect(second.status).toBe("fully-spent");
    expect(second.remaining).toBe(0);
  });
});

/* -------------------------------------------------------------- reporting */

describe("reporting", () => {
  const closed = completedBudget("b2", "August Food", 1_000, "2026-08-01", "2026-08-31");
  const open = makeBudget("b1", "Emergency", 5_000, null);
  const expenses = [
    expense("e1", "b2", "Groceries", 1_000, "2026-08-03"),
    expense("e2", "b1", "Medicine", 500, "2026-08-04"),
  ];

  it("keeps a fully spent budget in the history", () => {
    const days = buildHistory([open, closed], expenses);
    const forClosed = days.filter((day) => day.budgetId === "b2");

    expect(forClosed).toHaveLength(1);
    expect(forClosed[0].budgetStatus).toBe("fully_spent");
    expect(forClosed[0].endingBalance).toBe(0);
  });

  it("counts its allotment and spending in the totals", () => {
    const summary = summarizeHistory(buildHistory([open, closed], expenses));

    // Dropping the closed budget would understate both by ₱1,000.
    expect(summary.totalAllocated).toBe(6_000);
    expect(summary.totalExpenses).toBe(1_500);
    expect(summary.budgetCount).toBe(2);

    const entry = summary.budgets.find((b) => b.budgetId === "b2")!;
    expect(entry.budgetStatus).toBe("fully_spent");
    expect(entry.remaining).toBe(0);
  });

  it("names the status the PDF prints", () => {
    expect(budgetStatusLabel({ budgetStatus: "fully_spent" })).toBe("Fully Spent");
    expect(budgetStatusLabel({ budgetStatus: "active" })).toBe("Active");
  });
});
