/**
 * Combining two allotments into one.
 *
 * The rule these tests protect is that a merge is structural, not financial:
 * it changes which budget the money sits in and nothing about the money. So
 * every expense survives with every field it had, the three totals are the same
 * before and after, and the two originals stay as records of what they held.
 * Everything runs against real Postgres (PGlite), because the atomicity and the
 * eligibility rules live in the SQL.
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
  insertTransfer,
  listBudgetMerges,
  listBudgets,
  listExpenses,
  mergeBudgets,
  mergedPeriod,
  updateBudgetRow,
  updateExpenseRow,
} from "@/lib/db/tracker";
import {
  budgetsForDate,
  budgetsMergedInto,
  isMerged,
  mergedIntoBudget,
  summarizeBudgetsFromTotals,
  totalAllotted,
} from "@/lib/budgets";
import type { Budget } from "@/types/budget";

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
    email: `merger${seq}@example.com`,
    passwordHash: "hash-placeholder",
  });
}

const GENERAL = { startDate: null, endDate: null } as const;
const DATE = "2026-08-22";

async function allotment(
  userId: string,
  amount: number,
  name: string,
  period: { startDate: string | null; endDate: string | null } = GENERAL,
) {
  return insertBudget(userId, { name, amount, ...period });
}

async function spend(userId: string, budgetId: string, name: string, amount: number) {
  const result = await insertExpense(userId, {
    budgetId,
    name,
    amount,
    expenseDate: DATE,
  });
  if (!result.ok) throw new Error(`expected an expense, got "${result.reason}"`);
  return result.expense;
}

async function fold(userId: string, a: string, b: string, name: string) {
  const result = await mergeBudgets(userId, { sourceBudgetIds: [a, b], name });
  if (!result.ok) throw new Error(`expected a merge, got "${result.reason}"`);
  return result;
}

async function reload(userId: string, budgetId: string): Promise<Budget> {
  const found = (await listBudgets(userId)).find((entry) => entry.id === budgetId);
  if (!found) throw new Error("budget disappeared");
  return found;
}

function summaryFor(summaries: ReturnType<typeof summarizeBudgetsFromTotals>, id: string) {
  return summaries.find((entry) => entry.budget.id === id)!;
}

/** ₱5,000 Food (₱2,000 spent) and ₱3,000 Weekend (₱1,000 spent). */
async function twoBudgets() {
  const user = await makeUser();
  const food = await allotment(user.id, 5_000, "Food Budget");
  const weekend = await allotment(user.id, 3_000, "Weekend Budget");
  await spend(user.id, food.id, "Groceries", 1_500);
  await spend(user.id, food.id, "Transportation", 500);
  await spend(user.id, weekend.id, "Dinner", 700);
  await spend(user.id, weekend.id, "Medicine", 300);
  return { user, food, weekend };
}

/* --------------------------------------------------------------- the merge */

describe("merging two allotments", () => {
  it("adds the allocations and keeps the spending", async () => {
    const { user, food, weekend } = await twoBudgets();

    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    expect(merged.name).toBe("Combined Budget");
    expect(merged.amount).toBe(8_000);

    const summaries = summarizeBudgetsFromTotals(
      await listBudgets(user.id),
      await budgetTotals(user.id),
    );
    const combined = summaryFor(summaries, merged.id);

    expect(combined.totalExpenses).toBe(3_000);
    expect(combined.remaining).toBe(5_000);
  });

  it("preserves every expense exactly, moving only which budget owns it", async () => {
    const { user, food, weekend } = await twoBudgets();
    const before = await listExpenses(user.id);

    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");
    const after = await listExpenses(user.id);

    // Same rows, same count — nothing deleted and nothing duplicated.
    expect(after).toHaveLength(before.length);
    expect(after.map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort());

    for (const original of before) {
      const moved = after.find((entry) => entry.id === original.id)!;
      expect(moved.name).toBe(original.name);
      expect(moved.amount).toBe(original.amount);
      expect(moved.expenseDate).toBe(original.expenseDate);
      expect(moved.kind).toBe(original.kind);
      expect(moved.createdAt).toBe(original.createdAt);
      // The one field that changes, and the only one.
      expect(moved.budgetId).toBe(merged.id);
    }
  });

  it("shows all four expenses under the merged allotment, once each", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    const owned = (await listExpenses(user.id)).filter(
      (entry) => entry.budgetId === merged.id,
    );
    expect(owned.map((entry) => entry.name).sort()).toEqual([
      "Dinner",
      "Groceries",
      "Medicine",
      "Transportation",
    ]);

    const [totals] = await budgetTotals(user.id);
    expect(totals.budgetId).toBe(merged.id);
    expect(totals.expenseCount).toBe(4);
    expect(totals.totalExpenses).toBe(3_000);
  });

  it("marks both sources merged and points them at the result", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    for (const id of [food.id, weekend.id]) {
      const source = await reload(user.id, id);
      expect(source.status).toBe("merged");
      expect(source.mergedIntoBudgetId).toBe(merged.id);
      expect(source.mergedAt).not.toBeNull();
      expect(source.locked).toBe(true);
    }

    // Neither original is deleted; both remain as historical records.
    expect(await listBudgets(user.id)).toHaveLength(3);
  });

  it("takes both sources out of the allotments on offer", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    const budgets = await listBudgets(user.id);
    expect(budgetsForDate(budgets, DATE).map((b) => b.id)).toEqual([merged.id]);
    expect(budgets.filter(isMerged).map((b) => b.id).sort()).toEqual(
      [food.id, weekend.id].sort(),
    );
  });

  it("records what each source held when it was folded in", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    const [record] = await listBudgetMerges(user.id);
    expect(record.mergedBudgetId).toBe(merged.id);
    expect(record.totalAmount).toBe(8_000);
    expect(record.totalExpenses).toBe(3_000);
    expect(record.totalRemaining).toBe(5_000);

    const forFood = record.sources.find((s) => s.sourceBudgetId === food.id)!;
    expect(forFood.sourceName).toBe("Food Budget");
    expect(forFood.amount).toBe(5_000);
    // The snapshot is what makes this answerable at all: the source's own row
    // now has no expenses, because they moved.
    expect(forFood.totalExpenses).toBe(2_000);
    expect(forFood.remaining).toBe(3_000);
    expect(record.sources.map((s) => s.sourceBudgetId).sort()).toEqual(
      [food.id, weekend.id].sort(),
    );
  });

  it("lets the merged allotment take new expenses", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    await spend(user.id, merged.id, "Coffee", 100);
    const [totals] = await budgetTotals(user.id);
    expect(totals.totalExpenses).toBe(3_100);
  });
});

/* ------------------------------------------------- financial integrity --- */

describe("a merge creates and destroys nothing", () => {
  it("keeps allocation, spending and remaining identical", async () => {
    const { user, food, weekend } = await twoBudgets();

    const before = summarizeBudgetsFromTotals(
      await listBudgets(user.id),
      await budgetTotals(user.id),
    );
    const allottedBefore = totalAllotted(before.map((entry) => entry.budget));
    const spentBefore = before.reduce((sum, entry) => sum + entry.totalExpenses, 0);
    const remainingBefore = before.reduce((sum, entry) => sum + entry.remaining, 0);

    await fold(user.id, food.id, weekend.id, "Combined Budget");

    const after = summarizeBudgetsFromTotals(
      await listBudgets(user.id),
      await budgetTotals(user.id),
    );
    const allottedAfter = totalAllotted(after.map((entry) => entry.budget));
    // Merged sources hold nothing now, so only the open allotments are summed —
    // which is exactly what the dashboard does.
    const open = after.filter((entry) => !isMerged(entry.budget));
    const spentAfter = open.reduce((sum, entry) => sum + entry.totalExpenses, 0);
    const remainingAfter = open.reduce((sum, entry) => sum + entry.remaining, 0);

    expect(allottedAfter).toBe(allottedBefore);
    expect(spentAfter).toBe(spentBefore);
    expect(remainingAfter).toBe(remainingBefore);
    expect(allottedAfter).toBe(8_000);
  });

  it("does not count a merged source's allotment twice", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");

    const budgets = await listBudgets(user.id);
    // Three allotments exist, but only ₱8,000 was ever put aside.
    expect(budgets).toHaveLength(3);
    expect(totalAllotted(budgets)).toBe(8_000);
  });

  it("does not invent money when a transferred allotment is merged", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 10_000, "Main Budget");

    const moved = await insertTransfer(user.id, {
      sourceBudgetId: main.id,
      amount: 2_000,
      expenseDate: DATE,
      name: "Emergency Fund",
      ...GENERAL,
    });
    if (!moved.ok) throw new Error("expected a transfer");

    const travel = await allotment(user.id, 1_000, "Travel Fund");
    const before = totalAllotted(await listBudgets(user.id));
    expect(before).toBe(11_000);

    const { merged } = await fold(
      user.id,
      moved.destination.id,
      travel.id,
      "Combined Fund",
    );

    /*
     * ₱3,000 of allotment, but only ₱1,000 of it is new money — the other
     * ₱2,000 was moved out of Main Budget and is already counted there. A
     * yes/no "was this transferred?" could not express that: calling the result
     * direct would invent ₱2,000, calling it transferred would destroy ₱1,000.
     */
    expect(merged.amount).toBe(3_000);
    expect(merged.fundedAmount).toBe(1_000);
    expect(totalAllotted(await listBudgets(user.id))).toBe(before);
  });

  it("carries the funded figure through a chain of merges", async () => {
    const user = await makeUser();
    const a = await allotment(user.id, 1_000, "A");
    const b = await allotment(user.id, 2_000, "B");
    const c = await allotment(user.id, 4_000, "C");

    const first = await fold(user.id, a.id, b.id, "A+B");
    const second = await fold(user.id, first.merged.id, c.id, "A+B+C");

    expect(second.merged.amount).toBe(7_000);
    expect(second.merged.fundedAmount).toBe(7_000);
    expect(totalAllotted(await listBudgets(user.id))).toBe(7_000);
  });
});

/* --------------------------------------------------------------- the period */

describe("the merged period", () => {
  it("spans two dated allotments rather than picking one", () => {
    expect(
      mergedPeriod(
        { start_date: "2026-08-01", end_date: "2026-08-05" },
        { start_date: "2026-08-06", end_date: "2026-08-10" },
      ),
    ).toEqual({ startDate: "2026-08-01", endDate: "2026-08-10" });
  });

  it("keeps the same range when both already share it", () => {
    expect(
      mergedPeriod(
        { start_date: "2026-08-01", end_date: "2026-08-05" },
        { start_date: "2026-08-01", end_date: "2026-08-05" },
      ),
    ).toEqual({ startDate: "2026-08-01", endDate: "2026-08-05" });
  });

  it("includes the gap between two non-contiguous periods", () => {
    // The data model cannot hold two separate ranges, and the least restrictive
    // valid answer is the span — silently dropping days the user had would be
    // worse than covering a few they did not.
    expect(
      mergedPeriod(
        { start_date: "2026-08-01", end_date: "2026-08-05" },
        { start_date: "2026-09-01", end_date: "2026-09-05" },
      ),
    ).toEqual({ startDate: "2026-08-01", endDate: "2026-09-05" });
  });

  it("becomes unrestricted when either side is", () => {
    expect(
      mergedPeriod(
        { start_date: "2026-08-01", end_date: "2026-08-05" },
        { start_date: null, end_date: null },
      ),
    ).toEqual({ startDate: null, endDate: null });
    expect(
      mergedPeriod(
        { start_date: null, end_date: null },
        { start_date: "2026-08-01", end_date: "2026-08-05" },
      ),
    ).toEqual({ startDate: null, endDate: null });
  });

  it("applies that rule to the stored allotment", async () => {
    const user = await makeUser();
    const week = await allotment(user.id, 5_000, "Week One", {
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
    const next = await allotment(user.id, 3_000, "Week Two", {
      startDate: "2026-08-06",
      endDate: "2026-08-10",
    });

    const { merged } = await fold(user.id, week.id, next.id, "Both Weeks");
    expect(merged.startDate).toBe("2026-08-01");
    expect(merged.endDate).toBe("2026-08-10");

    const budgets = await listBudgets(user.id);
    // It funds every day both sources could, and no others.
    expect(budgetsForDate(budgets, "2026-08-03").map((b) => b.id)).toEqual([merged.id]);
    expect(budgetsForDate(budgets, "2026-08-09").map((b) => b.id)).toEqual([merged.id]);
    expect(budgetsForDate(budgets, "2026-08-20")).toEqual([]);
  });
});

/* ---------------------------------------------------------- eligibility --- */

describe("what cannot be merged", () => {
  it("refuses a fully spent allotment", async () => {
    const user = await makeUser();
    const spent = await allotment(user.id, 1_000, "Spent Out");
    await spend(user.id, spent.id, "Everything", 1_000);
    const other = await allotment(user.id, 2_000, "Other");

    // Merging would move its expenses out, rewriting what it records spending —
    // the very thing its lock exists to prevent.
    expect(
      await mergeBudgets(user.id, {
        sourceBudgetIds: [spent.id, other.id],
        name: "Combined",
      }),
    ).toEqual({ ok: false, reason: "locked" });

    expect(await listBudgets(user.id)).toHaveLength(2);
  });

  it("refuses an allotment that has already been merged", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");
    const other = await allotment(user.id, 1_000, "Another");

    expect(
      await mergeBudgets(user.id, {
        sourceBudgetIds: [food.id, other.id],
        name: "Again",
      }),
    ).toEqual({ ok: false, reason: "merged" });
  });

  it("refuses another account's allotment", async () => {
    const { user, food } = await twoBudgets();
    const intruder = await makeUser();
    const theirs = await allotment(intruder.id, 500, "Theirs");

    expect(
      await mergeBudgets(intruder.id, {
        sourceBudgetIds: [food.id, theirs.id],
        name: "Stolen",
      }),
    ).toEqual({ ok: false, reason: "not-found" });

    expect(await listBudgets(intruder.id)).toHaveLength(1);
    expect((await reload(user.id, food.id)).status).toBe("active");
  });

  it("refuses a budget merged with itself", async () => {
    const user = await makeUser();
    const only = await allotment(user.id, 1_000, "Only");

    expect(
      await mergeBudgets(user.id, {
        sourceBudgetIds: [only.id, only.id],
        name: "Itself",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses the second of two identical requests", async () => {
    const { user, food, weekend } = await twoBudgets();

    // A double submission: the same pair, twice. The second finds them already
    // folded in rather than producing a second allotment.
    const first = await mergeBudgets(user.id, {
      sourceBudgetIds: [food.id, weekend.id],
      name: "Combined Budget",
    });
    const second = await mergeBudgets(user.id, {
      sourceBudgetIds: [food.id, weekend.id],
      name: "Combined Budget",
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "merged" });
    expect(await listBudgets(user.id)).toHaveLength(3);
  });

  it("lets only one of two simultaneous merges succeed", async () => {
    const { user, food, weekend } = await twoBudgets();

    const results = await Promise.all([
      mergeBudgets(user.id, {
        sourceBudgetIds: [food.id, weekend.id],
        name: "First",
      }),
      mergeBudgets(user.id, {
        sourceBudgetIds: [food.id, weekend.id],
        name: "Second",
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    // Three budgets, not four: the loser wrote nothing.
    expect(await listBudgets(user.id)).toHaveLength(3);
  });
});

/* --------------------------------------------------------- immutability --- */

describe("a merged source", () => {
  it("cannot be edited", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");

    expect(
      await updateBudgetRow(user.id, food.id, {
        name: "Renamed",
        amount: 99_999,
        ...GENERAL,
      }),
    ).toEqual({ ok: false, reason: "merged" });

    const unchanged = await reload(user.id, food.id);
    expect(unchanged.name).toBe("Food Budget");
    expect(unchanged.amount).toBe(5_000);
  });

  it("cannot be deleted", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");

    expect(await deleteBudgetRow(user.id, food.id)).toEqual({
      ok: false,
      reason: "merged",
    });
    expect(await listBudgets(user.id)).toHaveLength(3);
  });

  it("cannot take a new expense", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");

    expect(
      await insertExpense(user.id, {
        budgetId: food.id,
        name: "Late entry",
        amount: 10,
        expenseDate: DATE,
      }),
    ).toEqual({ ok: false, reason: "merged" });
  });

  it("cannot have an expense moved back into it", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");
    const [expense] = await listExpenses(user.id);

    expect(
      await updateExpenseRow(user.id, expense.id, {
        budgetId: food.id,
        name: expense.name,
        amount: expense.amount,
        expenseDate: expense.expenseDate,
      }),
    ).toEqual({ ok: false, reason: "merged" });

    expect((await listExpenses(user.id))[0].budgetId).toBe(merged.id);
  });

  it("cannot be a transfer source", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");

    expect(
      await insertTransfer(user.id, {
        sourceBudgetId: food.id,
        amount: 100,
        expenseDate: DATE,
        name: "From nothing",
        ...GENERAL,
      }),
    ).toEqual({ ok: false, reason: "merged" });
  });

  it("stops the allotment it became part of being deleted", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    // Deleting it would leave both sources pointing at nothing.
    expect(await deleteBudgetRow(user.id, merged.id)).toEqual({
      ok: false,
      reason: "merged",
    });
  });
});

describe("the expenses that moved", () => {
  it("stay editable under their new allotment", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");
    const groceries = (await listExpenses(user.id)).find(
      (entry) => entry.name === "Groceries",
    )!;

    const edited = await updateExpenseRow(user.id, groceries.id, {
      budgetId: merged.id,
      name: "Groceries",
      amount: 1_600,
      expenseDate: groceries.expenseDate,
    });

    expect(edited.ok).toBe(true);
    const [totals] = await budgetTotals(user.id);
    expect(totals.totalExpenses).toBe(3_100);
  });

  it("stay deletable under their new allotment", async () => {
    const { user, food, weekend } = await twoBudgets();
    await fold(user.id, food.id, weekend.id, "Combined Budget");
    const dinner = (await listExpenses(user.id)).find((e) => e.name === "Dinner")!;

    expect((await deleteExpenseRow(user.id, dinner.id)).ok).toBe(true);
    expect(await listExpenses(user.id)).toHaveLength(3);
  });
});

/* ------------------------------------------------------------- completion */

describe("a merge that lands on zero", () => {
  it("follows the existing fully spent rule", async () => {
    const user = await makeUser();
    const a = await allotment(user.id, 1_000, "A");
    const b = await allotment(user.id, 2_000, "B");
    await spend(user.id, a.id, "Most of A", 900);
    await spend(user.id, b.id, "Most of B", 1_900);

    // ₱100 left in each, so ₱200 in the result — still open.
    const open = await fold(user.id, a.id, b.id, "Still Open");
    expect(open.merged.status).toBe("active");

    // Spending the rest closes it exactly as it would any allotment.
    await spend(user.id, open.merged.id, "The rest", 200);
    expect((await reload(user.id, open.merged.id)).status).toBe("fully_spent");
  });
});

/* -------------------------------------------------------------- atomicity */

describe("atomicity", () => {
  it("rolls everything back if a step fails", async () => {
    const { user, food, weekend } = await twoBudgets();
    const before = await listExpenses(user.id);

    /*
     * Fails the statement that marks a source merged, which runs after the new
     * allotment exists and after expenses have been moved. A half-finished
     * merge is the one outcome that would genuinely lose money: expenses under
     * a budget nobody can see, or sources still open and spendable alongside
     * the allotment that replaced them.
     */
    const real = getDatabase();
    const faulty: SqlExecutor = {
      query: <T,>(text: string, params?: unknown[]) => real.query<T>(text, params),
      transaction: (fn) =>
        real.transaction!(async (tx) =>
          fn({
            query: async <T,>(text: string, params?: unknown[]) => {
              if (/SET status = 'merged'/i.test(text)) throw new Error("boom");
              return tx.query<T>(text, params);
            },
          }),
        ),
    };

    await expect(
      mergeBudgets(
        user.id,
        { sourceBudgetIds: [food.id, weekend.id], name: "Combined" },
        faulty,
      ),
    ).rejects.toThrow(/boom/);

    // No new allotment, both sources open, every expense where it started.
    expect(await listBudgets(user.id)).toHaveLength(2);
    expect((await reload(user.id, food.id)).status).toBe("active");
    expect((await reload(user.id, weekend.id)).status).toBe("active");
    expect(await listBudgetMerges(user.id)).toEqual([]);

    const after = await listExpenses(user.id);
    expect(after).toHaveLength(before.length);
    for (const original of before) {
      const still = after.find((entry) => entry.id === original.id)!;
      expect(still.budgetId).toBe(original.budgetId);
      expect(still.amount).toBe(original.amount);
    }
  });
});

/* ----------------------------------------------------------- traceability */

describe("lineage", () => {
  it("answers what an allotment became and what it was made of", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");
    const budgets = await listBudgets(user.id);

    const source = budgets.find((entry) => entry.id === food.id)!;
    expect(mergedIntoBudget(budgets, source)?.id).toBe(merged.id);
    expect(budgetsMergedInto(budgets, merged.id).map((b) => b.id).sort()).toEqual(
      [food.id, weekend.id].sort(),
    );
  });

  it("keeps a transfer's origin visible after the destination is merged", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 10_000, "Main Budget");
    const moved = await insertTransfer(user.id, {
      sourceBudgetId: main.id,
      amount: 2_000,
      expenseDate: DATE,
      name: "Emergency Fund",
      ...GENERAL,
    });
    if (!moved.ok) throw new Error("expected a transfer");

    const travel = await allotment(user.id, 1_000, "Travel Fund");
    await fold(user.id, moved.destination.id, travel.id, "Combined Fund");

    // Emergency Fund is now merged, but it still records where its money came
    // from — so the chain Main → Emergency → Combined stays followable.
    const fund = await reload(user.id, moved.destination.id);
    expect(fund.status).toBe("merged");
    expect(fund.allocationType).toBe("transferred");
    expect(fund.sourceBudgetId).toBe(main.id);
    expect(fund.sourceTransactionId).toBe(moved.transfer.id);

    // And the transfer transaction itself is untouched in Main Budget.
    const transfer = (await listExpenses(user.id)).find(
      (entry) => entry.id === moved.transfer.id,
    )!;
    expect(transfer.budgetId).toBe(main.id);
    expect(transfer.kind).toBe("transfer");
  });

  it("survives both budgets being renamed afterwards", async () => {
    const { user, food, weekend } = await twoBudgets();
    const { merged } = await fold(user.id, food.id, weekend.id, "Combined Budget");

    await updateBudgetRow(user.id, merged.id, {
      name: "Renamed Result",
      amount: 8_000,
      ...GENERAL,
    });

    // The snapshot keeps the sources' names as they were; the record cannot be
    // rewritten by a later rename.
    const [record] = await listBudgetMerges(user.id);
    expect(record.sources.map((s) => s.sourceName).sort()).toEqual([
      "Food Budget",
      "Weekend Budget",
    ]);
  });
});
