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
import {
  deleteBudgetRow,
  deleteExpenseRow,
  insertBudget,
  insertExpense,
  listBudgets,
  loadTrackerData,
  setBudgetLockedRow,
  updateBudgetRow,
  updateExpenseRow,
} from "@/lib/db/tracker";
import { validateBudgetForm, validateExpenseForm } from "@/lib/validation";
import { budgetApplicability, budgetsForDate, isCompleted } from "@/lib/budgets";
import { isDatabaseConfigured } from "@/lib/db/client";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UNAUTHENTICATED = { ok: false as const, error: "Please log in again." };
const NOT_CONFIGURED = {
  ok: false as const,
  error: "The server is not connected to a database yet.",
};

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

  // Completed periods are immutable, which is what keeps past reports true.
  if (isCompleted(target)) {
    return { ok: false, error: "Completed budgets can no longer be edited." };
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

  const updated = await updateBudgetRow(userId, budgetId, result.values!);
  if (!updated) return { ok: false, error: "Budget not found." };

  refresh();
  return { ok: true, data: updated };
}

export async function setBudgetLockedAction(
  budgetId: string,
  locked: boolean,
): Promise<ActionResult<Budget>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const updated = await setBudgetLockedRow(userId, budgetId, locked);
  if (!updated) return { ok: false, error: "Budget not found." };

  refresh();
  return { ok: true, data: updated };
}

export async function deleteBudgetAction(
  budgetId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const deleted = await deleteBudgetRow(userId, budgetId);
  if (!deleted) return { ok: false, error: "Budget not found." };

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

export async function createExpenseAction(
  input: ExpenseInput,
): Promise<ActionResult<Expense>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const check = await validateExpenseAgainstServer(userId, input);
  if (!check.ok) return check;

  const expense = await insertExpense(userId, input);
  if (!expense) return { ok: false, error: "Budget not found." };

  refresh();
  return { ok: true, data: expense };
}

export async function updateExpenseAction(
  expenseId: string,
  input: ExpenseInput,
): Promise<ActionResult<Expense>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const check = await validateExpenseAgainstServer(userId, input, expenseId);
  if (!check.ok) return check;

  const updated = await updateExpenseRow(userId, expenseId, input);
  if (!updated) return { ok: false, error: "Expense not found." };

  refresh();
  return { ok: true, data: updated };
}

export async function deleteExpenseAction(
  expenseId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!isDatabaseConfigured()) return NOT_CONFIGURED;
  const userId = await getUserId();
  if (!userId) return UNAUTHENTICATED;

  const deleted = await deleteExpenseRow(userId, expenseId);
  if (!deleted) return { ok: false, error: "Expense not found." };

  refresh();
  return { ok: true, data: { id: expenseId } };
}
