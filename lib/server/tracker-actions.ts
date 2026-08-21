"use server";

/**
 * Budget and expense server actions.
 *
 * Each one resolves the caller from the session and passes that id to the
 * repository, which filters every statement by it. A client that submits
 * another account's budget id gets "not found", because the row simply does not
 * match — ownership is enforced in the query, not by a check that could be
 * forgotten.
 */

import { revalidatePath } from "next/cache";

import type { Budget, BudgetInput } from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import { getUserId } from "@/lib/server/session";
import type { Page } from "@/lib/pagination";
import {
  budgetTotals,
  budgetTotalsBefore,
  listExpensesMatching,
  listExpensesPage,
  type BudgetTotal,
  type ExpenseQuery,
  deleteBudgetRow,
  deleteExpenseRow,
  insertBudget,
  insertExpense,
  listBudgets,
  loadTrackerData,
  setBudgetLockedRow,
  updateBudgetRow,
  updateExpenseRow,
  type WriteRefusal,
} from "@/lib/db/tracker";
import { validateBudgetForm, validateExpenseForm } from "@/lib/validation";
import {
  FULLY_SPENT_LABEL,
  budgetApplicability,
  budgetsForDate,
  expensesOutsidePeriod,
  isFullySpent,
  isPeriodEnded,
} from "@/lib/budgets";
import { formatCurrency } from "@/lib/currency";
import { isDatabaseConfigured } from "@/lib/db/client";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UNAUTHENTICATED = { ok: false as const, error: "Please log in again." };
const NOT_CONFIGURED = {
  ok: false as const,
  error: "The server is not connected to a database yet.",
};

/**
 * What the caller is told when a write is refused.
 *
 * The lock is not advice the UI may take or leave. Screens hide the controls,
 * but these messages are what a request that skipped the screen entirely gets
 * back — the rule lives on this side of the boundary.
 */
const LOCKED_BUDGET_ERROR = `This budget is ${FULLY_SPENT_LABEL} and locked. It can no longer be changed.`;
const LOCKED_EXPENSE_ERROR = `This expense belongs to a ${FULLY_SPENT_LABEL} budget and can no longer be changed.`;

function refusal(
  reason: WriteRefusal,
  remaining: number | undefined,
  missing: string,
  lockedError: string,
): { ok: false; error: string } {
  if (reason === "locked") return { ok: false, error: lockedError };
  if (reason === "insufficient") {
    return {
      ok: false,
      error: `Insufficient budget balance. ${formatCurrency(
        Math.max(remaining ?? 0, 0),
      )} remains in this allotment.`,
    };
  }
  return { ok: false, error: missing };
}

function refresh(): void {
  revalidatePath("/tracker");
  revalidatePath("/budgets");
  revalidatePath("/history");
}

export async function loadTrackerAction(): Promise<
  ActionResult<{ budgets: Budget[]; expenses: Expense[] }>
> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  return { ok: true, data: await loadTrackerData(userId) };
}

/**
 * One page of the caller's expenses.
 *
 * The query is scoped to the session's user before anything else is applied, so
 * a page, a sort or a budget filter can only ever move within that account's
 * own rows.
 */
export async function listExpensesAction(
  query: ExpenseQuery = {},
): Promise<ActionResult<Page<Expense>>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  return { ok: true, data: await listExpensesPage(userId, query) };
}

/** The caller's budgets, re-read after a write that may have closed one. */
export async function listBudgetsAction(): Promise<ActionResult<Budget[]>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  return { ok: true, data: await listBudgets(userId) };
}

/** Per-budget totals, so balances survive the expense list being paginated. */
export async function budgetTotalsAction(): Promise<ActionResult<BudgetTotal[]>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  return { ok: true, data: await budgetTotals(userId) };
}

/**
 * Everything history needs for one filter.
 *
 * The expenses inside the window, plus what each budget had already spent
 * before it. History and its export both read the whole of what the filter
 * selected rather than a page — the filter is the bound — and the opening
 * figures keep each budget's running balance true without shipping the rows
 * that came before.
 */
export async function loadHistoryAction(
  query: Omit<ExpenseQuery, "page" | "pageSize"> = {},
): Promise<
  ActionResult<{ expenses: Expense[]; spentBefore: Array<[string, number]> }>
> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const [expenses, before] = await Promise.all([
    listExpensesMatching(userId, query),
    query.from
      ? budgetTotalsBefore(userId, query.from)
      : Promise.resolve([]),
  ]);

  return {
    ok: true,
    data: {
      expenses,
      spentBefore: before.map((entry) => [entry.budgetId, entry.totalExpenses]),
    },
  };
}

/* ----------------------------------------------------------------- budgets */

export async function createBudgetAction(
  input: BudgetInput,
): Promise<ActionResult<Budget>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  // Applicability is derived from the dates the client sent rather than trusted
  // as a separate field, so the stored row and its declared type cannot drift.
  const result = validateBudgetForm(
    input.name,
    String(input.amount),
    budgetApplicability(input),
    input.startDate ?? "",
    input.endDate ?? "",
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.errors.name ?? result.errors.amount ?? result.errors.period!,
    };
  }

  const budget = await insertBudget(userId, result.values!);
  refresh();
  return { ok: true, data: budget };
}

export async function updateBudgetAction(
  budgetId: string,
  input: BudgetInput,
): Promise<ActionResult<Budget>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const existing = await listBudgets(userId);
  const target = existing.find((budget) => budget.id === budgetId);
  if (!target) return { ok: false, error: "Budget not found." };

  // A budget spent down to zero is a closed record — no edit, no unlock, no
  // exception. Re-checked in SQL as well; this is only here to say why.
  if (isFullySpent(target)) {
    return { ok: false, error: LOCKED_BUDGET_ERROR };
  }

  // A period that has already passed stays immutable too, which is what keeps
  // past reports true.
  if (isPeriodEnded(target)) {
    return {
      ok: false,
      error: "Budgets whose period has ended can no longer be edited.",
    };
  }

  const result = validateBudgetForm(
    input.name,
    String(input.amount),
    budgetApplicability(input),
    input.startDate ?? "",
    input.endDate ?? "",
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.errors.name ?? result.errors.amount ?? result.errors.period!,
    };
  }

  /*
   * Narrowing a period must not strand the expenses charged to it.
   *
   * Checked here rather than only in the form: the browser's copy of the
   * expenses is a page, not the whole set, and the rule has to hold whatever
   * the client happened to have loaded.
   */
  const own = await listExpensesMatching(userId, { budgetId });
  const stranded = expensesOutsidePeriod(target, own, result.values!);
  if (stranded.length > 0) {
    return {
      ok: false,
      error:
        stranded.length === 1
          ? "1 recorded expense falls outside the new period."
          : `${stranded.length} recorded expenses fall outside the new period.`,
    };
  }

  const updated = await updateBudgetRow(userId, budgetId, result.values!);
  if (!updated.ok) {
    return refusal(
      updated.reason,
      updated.remaining,
      "Budget not found.",
      LOCKED_BUDGET_ERROR,
    );
  }

  refresh();
  return { ok: true, data: updated.budget };
}

export async function setBudgetLockedAction(
  budgetId: string,
  locked: boolean,
): Promise<ActionResult<Budget>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const updated = await setBudgetLockedRow(userId, budgetId, locked);
  if (!updated.ok) {
    // There is no unlock for a fully spent budget; the flag this action toggles
    // is a different lock and has no power over that one.
    return refusal(
      updated.reason,
      updated.remaining,
      "Budget not found.",
      LOCKED_BUDGET_ERROR,
    );
  }

  refresh();
  return { ok: true, data: updated.budget };
}

export async function deleteBudgetAction(
  budgetId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const deleted = await deleteBudgetRow(userId, budgetId);
  if (!deleted.ok) {
    return refusal(
      deleted.reason,
      deleted.remaining,
      "Budget not found.",
      LOCKED_BUDGET_ERROR,
    );
  }

  refresh();
  return { ok: true, data: { id: budgetId } };
}

/* ---------------------------------------------------------------- expenses */

async function validateExpenseAgainstServer(
  userId: string,
  input: ExpenseInput,
  excludeExpenseId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Only this user's budgets are ever loaded, so a budget id belonging to
  // another account is simply absent from the eligible list and is refused
  // below — the check cannot be forgotten because there is nothing else to
  // match against.
  const { budgets, expenses } = await loadTrackerData(userId);

  /*
   * A fully spent budget is refused by name rather than by absence.
   *
   * `budgetsForDate` already leaves closed allotments out, so this would fail
   * anyway — but as "not available for the selected date", which is the wrong
   * reason and would puzzle anyone whose budget closed while the form was open.
   */
  const named = budgets.find((budget) => budget.id === input.budgetId);
  if (named && isFullySpent(named)) {
    return { ok: false, error: LOCKED_BUDGET_ERROR };
  }

  const eligible = budgetsForDate(budgets, input.expenseDate);

  const budget = eligible.find((entry) => entry.id === input.budgetId);
  const own = budget
    ? expenses.filter(
        (expense) =>
          expense.budgetId === budget.id && expense.id !== excludeExpenseId,
      )
    : [];

  const availableBalance = budget
    ? budget.amount - own.reduce((sum, expense) => sum + expense.amount, 0)
    : undefined;

  const result = validateExpenseForm(
    input.name,
    String(input.amount),
    input.expenseDate,
    input.budgetId,
    { eligibleBudgets: eligible, availableBalance },
  );

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.errors.name ??
        result.errors.amount ??
        result.errors.expenseDate ??
        result.errors.budgetId!,
    };
  }

  return { ok: true };
}

/**
 * What an expense write returns.
 *
 * The budget comes back with the expense because recording one can close it:
 * the client has to learn that the allotment it just spent against is now a
 * locked record, and learning it from the same response means there is no
 * moment where the screen still offers to spend more.
 */
export interface ExpenseWrite {
  expense: Expense;
  budget: Budget;
}

export async function createExpenseAction(
  input: ExpenseInput,
): Promise<ActionResult<ExpenseWrite>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const check = await validateExpenseAgainstServer(userId, input);
  if (!check.ok) return check;

  /*
   * The validation above reads a balance; this call re-checks it while holding
   * the budget's row lock and writes in the same transaction. Two requests that
   * both passed validation against the same ₱500 cannot both commit — the
   * second one blocks, re-reads, and is refused.
   */
  const result = await insertExpense(userId, input);
  if (!result.ok) {
    return refusal(
      result.reason,
      result.remaining,
      "Budget not found.",
      LOCKED_BUDGET_ERROR,
    );
  }

  refresh();
  return { ok: true, data: { expense: result.expense, budget: result.budget } };
}

export async function updateExpenseAction(
  expenseId: string,
  input: ExpenseInput,
): Promise<ActionResult<ExpenseWrite>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  // An expense charged to a closed budget is part of that record. Changing it
  // — including moving it to another allotment — would rewrite history, so the
  // request is refused before it is even validated.
  const locked = await expenseBelongsToClosedBudget(userId, expenseId);
  if (locked) return { ok: false, error: LOCKED_EXPENSE_ERROR };

  const check = await validateExpenseAgainstServer(userId, input, expenseId);
  if (!check.ok) return check;

  const result = await updateExpenseRow(userId, expenseId, input);
  if (!result.ok) {
    return refusal(
      result.reason,
      result.remaining,
      "Expense not found.",
      LOCKED_EXPENSE_ERROR,
    );
  }

  refresh();
  return { ok: true, data: { expense: result.expense, budget: result.budget } };
}

export async function deleteExpenseAction(
  expenseId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const deleted = await deleteExpenseRow(userId, expenseId);
  if (!deleted.ok) {
    return refusal(
      deleted.reason,
      deleted.remaining,
      "Expense not found.",
      LOCKED_EXPENSE_ERROR,
    );
  }

  refresh();
  return { ok: true, data: { id: deleted.id } };
}

/**
 * True when the expense is part of a closed budget's record.
 *
 * Only ever used to produce a clearer message: the repository refuses the write
 * regardless, under the budget's row lock, so this cannot be raced past.
 */
async function expenseBelongsToClosedBudget(
  userId: string,
  expenseId: string,
): Promise<boolean> {
  const { budgets, expenses } = await loadTrackerData(userId);
  const expense = expenses.find((entry) => entry.id === expenseId);
  if (!expense) return false;

  const budget = budgets.find((entry) => entry.id === expense.budgetId);
  return budget ? isFullySpent(budget) : false;
}
