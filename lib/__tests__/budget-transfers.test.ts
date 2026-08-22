/**
 * Moving money between allotments.
 *
 * The rule these tests protect is that a transfer moves funds, it does not
 * create them. ₱2,000 taken out of Main Budget and made into an Emergency Fund
 * leaves the user with exactly the money they had — so the source must fall,
 * the destination must exist, and neither the spending totals nor the allotted
 * totals may grow. Everything runs against real Postgres (PGlite), because the
 * atomicity and the balance check live in the SQL.
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
  listBudgets,
  listExpenses,
  updateBudgetRow,
  updateExpenseRow,
} from "@/lib/db/tracker";
import {
  budgetsForDate,
  budgetsFundedBy,
  isTransferred,
  sourceBudgetOf,
  summarizeBudgets,
  summarizeBudgetsFromTotals,
  totalAllotted,
} from "@/lib/budgets";
import { buildHistory, summarizeHistory } from "@/lib/history";
import { allocationLabel, reportSummaryRows } from "@/lib/pdf/report";
import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { budget as makeBudget, expense, transfer, transferredBudget } from "./helpers";

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
    email: `mover${seq}@example.com`,
    passwordHash: "hash-placeholder",
  });
}

const GENERAL = { startDate: null, endDate: null } as const;
const DATE = "2026-08-22";

async function allotment(userId: string, amount: number, name = "Main Budget") {
  return insertBudget(userId, { name, amount, ...GENERAL });
}

async function reload(userId: string, budgetId: string): Promise<Budget> {
  const found = (await listBudgets(userId)).find((entry) => entry.id === budgetId);
  if (!found) throw new Error("budget disappeared");
  return found;
}

/** Moves money and fails loudly if the write was refused. */
async function move(
  userId: string,
  sourceBudgetId: string,
  amount: number,
  name: string,
  period: { startDate: string | null; endDate: string | null } = GENERAL,
) {
  const result = await insertTransfer(userId, {
    sourceBudgetId,
    amount,
    expenseDate: DATE,
    name,
    ...period,
  });
  if (!result.ok) throw new Error(`expected a transfer, got "${result.reason}"`);
  return result;
}

/** ₱10,000 in Main Budget, ₱2,000 of it moved into an Emergency Fund. */
async function movedFunds() {
  const user = await makeUser();
  const main = await allotment(user.id, 10_000);
  const result = await move(user.id, main.id, 2_000, "Emergency Fund");
  return { user, main: result.source, fund: result.destination, transfer: result.transfer };
}

/* -------------------------------------------------------------- the move */

describe("a budget transfer", () => {
  it("deducts the source and creates the destination in one write", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 10_000);

    const result = await insertTransfer(user.id, {
      sourceBudgetId: main.id,
      amount: 2_000,
      expenseDate: DATE,
      name: "Emergency Fund",
      ...GENERAL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.destination.name).toBe("Emergency Fund");
    expect(result.destination.amount).toBe(2_000);
    expect(result.destination.allocationType).toBe("transferred");
    expect(result.destination.sourceBudgetId).toBe(main.id);
    expect(result.destination.sourceTransactionId).toBe(result.transfer.id);
    expect(result.transfer.transferBudgetId).toBe(result.destination.id);
  });

  it("records the deduction as a transfer, not an expense", async () => {
    const { user, fund } = await movedFunds();

    const [recorded] = await listExpenses(user.id);
    expect(recorded.kind).toBe("transfer");
    // The row knows which allotment it produced, read back from that budget.
    expect(recorded.transferBudgetId).toBe(fund.id);
    expect(recorded.amount).toBe(2_000);
  });

  it("leaves the source with the balance the transfer took", async () => {
    const { user, main, fund } = await movedFunds();

    const [totals] = await budgetTotals(user.id);
    expect(totals.budgetId).toBe(main.id);
    // The money left the budget, so the balance falls — but it was not spent.
    expect(totals.totalTransferred).toBe(2_000);
    expect(totals.totalExpenses).toBe(0);
    expect(totals.transferCount).toBe(1);
    expect(totals.expenseCount).toBe(0);

    const summaries = summarizeBudgetsFromTotals(
      await listBudgets(user.id),
      await budgetTotals(user.id),
    );
    const source = summaries.find((entry) => entry.budget.id === main.id)!;
    const destination = summaries.find((entry) => entry.budget.id === fund.id)!;

    expect(source.remaining).toBe(8_000);
    expect(source.totalExpenses).toBe(0);
    expect(source.totalTransferred).toBe(2_000);
    expect(destination.remaining).toBe(2_000);
    expect(destination.totalExpenses).toBe(0);
  });

  it("gives the new allotment its own period", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 10_000);

    const { destination } = await move(user.id, main.id, 2_000, "Travel Fund", {
      startDate: "2026-08-25",
      endDate: "2026-08-30",
    });

    expect(destination.startDate).toBe("2026-08-25");
    expect(destination.endDate).toBe("2026-08-30");
    // And it behaves like any other dated allotment from that moment on.
    const budgets = await listBudgets(user.id);
    expect(budgetsForDate(budgets, "2026-08-27").map((b) => b.id)).toContain(
      destination.id,
    );
    expect(budgetsForDate(budgets, "2026-09-15").map((b) => b.id)).not.toContain(
      destination.id,
    );
  });

  it("lets the new allotment fund expenses of its own", async () => {
    const { user, fund } = await movedFunds();

    const spent = await insertExpense(user.id, {
      budgetId: fund.id,
      name: "Medicine",
      amount: 500,
      expenseDate: DATE,
    });

    expect(spent.ok).toBe(true);
    const totals = await budgetTotals(user.id);
    const forFund = totals.find((entry) => entry.budgetId === fund.id)!;
    expect(forFund.totalExpenses).toBe(500);
    expect(forFund.totalTransferred).toBe(0);
  });

  it("can itself be a source, without inventing money", async () => {
    const { user, fund } = await movedFunds();
    const { destination: travel } = await move(user.id, fund.id, 500, "Travel Fund");

    const budgets = await listBudgets(user.id);
    expect(travel.sourceBudgetId).toBe(fund.id);

    // ₱10,000 was ever allotted; the chain only redistributed it.
    expect(totalAllotted(budgets)).toBe(10_000);
    const summaries = summarizeBudgetsFromTotals(budgets, await budgetTotals(user.id));
    expect(
      summaries.reduce((sum, entry) => sum + entry.remaining, 0),
    ).toBe(10_000);
  });
});

/* --------------------------------------------------------- no new money */

describe("a transfer does not create money", () => {
  it("leaves the total allotted unchanged", async () => {
    const { user } = await movedFunds();
    const budgets = await listBudgets(user.id);

    // Two allotments now exist, but only ₱10,000 was ever put aside. Summing
    // both amounts would report ₱12,000 for a person who has ₱10,000.
    expect(budgets).toHaveLength(2);
    expect(totalAllotted(budgets)).toBe(10_000);
  });

  it("leaves the total remaining unchanged", async () => {
    const { user } = await movedFunds();
    const summaries = summarizeBudgetsFromTotals(
      await listBudgets(user.id),
      await budgetTotals(user.id),
    );

    // ₱8,000 in the source plus ₱2,000 in the destination.
    expect(summaries.reduce((sum, entry) => sum + entry.remaining, 0)).toBe(10_000);
  });

  it("counts as no spending at all", async () => {
    const { user } = await movedFunds();
    const totals = await budgetTotals(user.id);
    expect(totals.reduce((sum, entry) => sum + entry.totalExpenses, 0)).toBe(0);
  });

  it("keeps spending and moving apart once both have happened", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 13_000);
    await insertExpense(user.id, {
      budgetId: main.id,
      name: "Groceries",
      amount: 3_000,
      expenseDate: DATE,
    });
    await move(user.id, main.id, 2_000, "Emergency Fund");

    const summaries = summarizeBudgetsFromTotals(
      await listBudgets(user.id),
      await budgetTotals(user.id),
    );
    const source = summaries.find((entry) => entry.budget.id === main.id)!;

    expect(source.budget.amount).toBe(13_000);
    expect(source.totalExpenses).toBe(3_000);
    expect(source.totalTransferred).toBe(2_000);
    expect(source.totalDeducted).toBe(5_000);
    expect(source.remaining).toBe(8_000);
  });
});

/* ------------------------------------------------------------ validation */

describe("validation", () => {
  it("refuses to move more than the source has", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 1_000);

    const result = await insertTransfer(user.id, {
      sourceBudgetId: main.id,
      amount: 1_500,
      expenseDate: DATE,
      name: "Emergency Fund",
      ...GENERAL,
    });

    expect(result).toEqual({ ok: false, reason: "insufficient", remaining: 1_000 });

    // Nothing partial: no deduction, and above all no destination allotment.
    expect(await listExpenses(user.id)).toHaveLength(0);
    expect(await listBudgets(user.id)).toHaveLength(1);
  });

  it("refuses to move out of a fully spent budget", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 1_000);
    await insertExpense(user.id, {
      budgetId: main.id,
      name: "Everything",
      amount: 1_000,
      expenseDate: DATE,
    });

    const result = await insertTransfer(user.id, {
      sourceBudgetId: main.id,
      amount: 1,
      expenseDate: DATE,
      name: "Emergency Fund",
      ...GENERAL,
    });

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(await listBudgets(user.id)).toHaveLength(1);
  });

  it("refuses to move out of another account's budget", async () => {
    const { main } = await movedFunds();
    const intruder = await makeUser();

    const result = await insertTransfer(intruder.id, {
      sourceBudgetId: main.id,
      amount: 100,
      expenseDate: DATE,
      name: "Stolen Fund",
      ...GENERAL,
    });

    // Not "locked" — a stranger learns nothing about whether it exists.
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await listBudgets(intruder.id)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ completion */

describe("moving the whole balance", () => {
  it("closes the source and leaves the destination active", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 2_000);

    const { source, destination } = await move(user.id, main.id, 2_000, "Emergency Fund");

    expect(source.status).toBe("fully_spent");
    expect(source.locked).toBe(true);
    expect(source.completedAt).not.toBeNull();
    expect(destination.status).toBe("active");
  });

  it("takes the closed source out of the allotments on offer", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 2_000);
    const { destination } = await move(user.id, main.id, 2_000, "Emergency Fund");

    const offered = budgetsForDate(await listBudgets(user.id), DATE).map((b) => b.id);
    expect(offered).toEqual([destination.id]);
  });

  it("still leaves ₱1 short of closing when it is ₱1 short", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 2_000);
    const { source } = await move(user.id, main.id, 1_999, "Emergency Fund");
    expect(source.status).toBe("active");
  });
});

/* ---------------------------------------------------------- immutability */

describe("a committed transfer", () => {
  it("cannot be edited as though it were an expense", async () => {
    const { user, main, transfer: moved } = await movedFunds();

    expect(
      await updateExpenseRow(user.id, moved.id, {
        budgetId: main.id,
        name: "Emergency Fund",
        amount: 1,
        expenseDate: DATE,
      }),
    ).toEqual({ ok: false, reason: "transfer" });

    const [unchanged] = await listExpenses(user.id);
    expect(unchanged.amount).toBe(2_000);
  });

  it("cannot be deleted", async () => {
    const { user, transfer: moved } = await movedFunds();

    expect(await deleteExpenseRow(user.id, moved.id)).toEqual({
      ok: false,
      reason: "transfer",
    });
    expect(await listExpenses(user.id)).toHaveLength(1);
  });

  it("fixes the destination's amount, but not its name", async () => {
    const { user, fund } = await movedFunds();

    expect(
      await updateBudgetRow(user.id, fund.id, {
        name: "Emergency Fund",
        amount: 9_999,
        ...GENERAL,
      }),
    ).toEqual({ ok: false, reason: "transfer" });

    // A mistyped label is still correctable — nothing about the money moves.
    const renamed = await updateBudgetRow(user.id, fund.id, {
      name: "Rainy Day Fund",
      amount: 2_000,
      ...GENERAL,
    });
    expect(renamed.ok && renamed.budget.name).toBe("Rainy Day Fund");
    expect((await reload(user.id, fund.id)).amount).toBe(2_000);
  });

  it("stops the destination being deleted", async () => {
    const { user, fund } = await movedFunds();

    // Deleting it would make the ₱2,000 deducted from the source vanish
    // instead of returning.
    expect(await deleteBudgetRow(user.id, fund.id)).toEqual({
      ok: false,
      reason: "transfer",
    });
    expect(await listBudgets(user.id)).toHaveLength(2);
  });

  it("stops the source being deleted while it funds something", async () => {
    const { user, main } = await movedFunds();

    expect(await deleteBudgetRow(user.id, main.id)).toEqual({
      ok: false,
      reason: "has-transfers",
    });
    expect(await listBudgets(user.id)).toHaveLength(2);
  });
});

/* -------------------------------------------------------------- atomicity */

describe("atomicity", () => {
  it("rolls the deduction back if the destination cannot be created", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 10_000);

    /*
     * Fails the budget insert, which runs *after* the deduction.
     *
     * If the two were separate writes the source would be ₱2,000 poorer with
     * nothing to show for it — money destroyed rather than moved. In one
     * transaction the deduction has to disappear with the failure.
     */
    const real = getDatabase();
    const faulty: SqlExecutor = {
      query: <T,>(text: string, params?: unknown[]) => real.query<T>(text, params),
      transaction: (fn) =>
        real.transaction!(async (tx) =>
          fn({
            query: async <T,>(text: string, params?: unknown[]) => {
              if (/^\s*INSERT INTO budgets/i.test(text)) throw new Error("boom");
              return tx.query<T>(text, params);
            },
          }),
        ),
    };

    await expect(
      insertTransfer(
        user.id,
        {
          sourceBudgetId: main.id,
          amount: 2_000,
          expenseDate: DATE,
          name: "Emergency Fund",
          ...GENERAL,
        },
        faulty,
      ),
    ).rejects.toThrow(/boom/);

    expect(await listExpenses(user.id)).toHaveLength(0);
    expect(await listBudgets(user.id)).toHaveLength(1);
    expect(await budgetTotals(user.id)).toEqual([]);
    expect((await reload(user.id, main.id)).status).toBe("active");
  });

  it("does not let two transfers spend the same balance", async () => {
    const user = await makeUser();
    const main = await allotment(user.id, 2_000);

    const results = await Promise.all(
      ["First Fund", "Second Fund"].map((name) =>
        insertTransfer(user.id, {
          sourceBudgetId: main.id,
          amount: 2_000,
          expenseDate: DATE,
          name,
          ...GENERAL,
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    // One allotment was created, not two — the loser wrote nothing.
    expect(await listBudgets(user.id)).toHaveLength(2);
    expect(await listExpenses(user.id)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ traceability */

describe("the source relationship", () => {
  it("answers where an allotment's money came from", async () => {
    const { user, main, fund } = await movedFunds();
    const budgets = await listBudgets(user.id);

    const destination = budgets.find((entry) => entry.id === fund.id)!;
    expect(isTransferred(destination)).toBe(true);
    expect(sourceBudgetOf(budgets, destination)?.id).toBe(main.id);
    expect(allocationLabel(destination)).toBe("Transferred");
  });

  it("answers what a budget funded", async () => {
    const { user, main, fund } = await movedFunds();
    const funded = budgetsFundedBy(await listBudgets(user.id), main.id);
    expect(funded.map((entry) => entry.id)).toEqual([fund.id]);
  });

  it("survives both budgets being renamed", async () => {
    const { user, main, fund } = await movedFunds();

    await updateBudgetRow(user.id, main.id, {
      name: "Renamed Source",
      amount: 10_000,
      ...GENERAL,
    });
    await updateBudgetRow(user.id, fund.id, {
      name: "Renamed Fund",
      amount: 2_000,
      ...GENERAL,
    });

    const budgets = await listBudgets(user.id);
    const destination = budgets.find((entry) => entry.id === fund.id)!;
    // The link is by id, so a label change cannot break it.
    expect(sourceBudgetOf(budgets, destination)?.name).toBe("Renamed Source");
  });
});

/* -------------------------------------------------------------- reporting */

describe("reporting", () => {
  const main = makeBudget("b1", "Main Budget", 13_000, null);
  const fund = transferredBudget("b2", "Emergency Fund", 2_000, "b1", "t1");
  const rows: Expense[] = [
    expense("e1", "b1", "Groceries", 500, "2026-08-22"),
    expense("e2", "b1", "Transportation", 300, "2026-08-22"),
    transfer("t1", "b1", "Emergency Fund", 2_000, "2026-08-22", "b2"),
  ];
  const days = buildHistory([main, fund], rows);

  it("chains the balance down by everything that left", async () => {
    const day = days.find((entry) => entry.budgetId === "b1")!;
    expect(day.totalExpenses).toBe(800);
    expect(day.totalTransferred).toBe(2_000);
    expect(day.startingBalance).toBe(13_000);
    expect(day.endingBalance).toBe(10_200);
  });

  it("keeps the transfer out of the expense total", () => {
    const summary = summarizeHistory(days);
    expect(summary.totalExpenses).toBe(800);
    expect(summary.totalTransferred).toBe(2_000);
  });

  it("does not count the transferred allotment as new money", () => {
    const summary = summarizeHistory(days);
    // ₱13,000 was allotted. Adding the Emergency Fund's ₱2,000 would claim
    // ₱15,000 for a person who never had more than ₱13,000.
    expect(summary.totalAllocated).toBe(13_000);
  });

  it("identifies the source and destination in the summary", () => {
    const summary = summarizeHistory(days);
    const source = summary.budgets.find((entry) => entry.budgetId === "b1")!;

    expect(source.totalTransferred).toBe(2_000);
    expect(source.transferCount).toBe(1);
    expect(source.expenseCount).toBe(2);
    expect(source.allocationType).toBe("direct");
  });

  it("gives the PDF a transfer line separate from expenses", () => {
    const labels = reportSummaryRows(summarizeHistory(days));
    expect(labels).toContainEqual([
      "Transferred Between Allotments",
      "₱2,000.00",
    ]);
    expect(labels).toContainEqual(["Total Expenses Across Budgets", "₱800.00"]);
    expect(labels).toContainEqual(["Total Allocated Across Budgets", "₱13,000.00"]);
  });

  it("omits the transfer line from a report with no transfers", () => {
    const plain = summarizeHistory(
      buildHistory([main], [expense("e1", "b1", "Groceries", 500, "2026-08-22")]),
    );
    expect(
      reportSummaryRows(plain).map(([label]) => label),
    ).not.toContain("Transferred Between Allotments");
  });

  it("summarises the same way from expense rows as from SQL totals", () => {
    const [fromRows] = summarizeBudgets([main], rows);
    expect(fromRows.totalExpenses).toBe(800);
    expect(fromRows.totalTransferred).toBe(2_000);
    expect(fromRows.remaining).toBe(10_200);
  });
});
