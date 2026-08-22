/** Shared fixtures for the domain tests. */

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";

/**
 * A budget fixture.
 *
 * Passing `null` for the dates builds a general allotment — the same two nulls
 * the database stores, so the tests exercise the real representation rather
 * than a stand-in.
 */
export function budget(
  id: string,
  name: string,
  amount: number,
  startDate: string | null,
  endDate: string | null = startDate,
  overrides: Partial<Budget> = {},
): Budget {
  return {
    id,
    name,
    amount,
    startDate,
    endDate: startDate === null ? null : endDate,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    locked: true,
    // Open unless a test says otherwise; `completedBudget` builds a closed one.
    status: "active",
    completedAt: null,
    // Directly allotted unless a test says otherwise; `transferredBudget`
    // builds one funded by moving money.
    allocationType: "direct",
    sourceBudgetId: null,
    sourceTransactionId: null,
    ...overrides,
  };
}

/** A budget spent down to exactly ₱0.00 and closed. */
export function completedBudget(
  id: string,
  name: string,
  amount: number,
  startDate: string | null,
  endDate: string | null = startDate,
  overrides: Partial<Budget> = {},
): Budget {
  return budget(id, name, amount, startDate, endDate, {
    status: "fully_spent",
    completedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  });
}

/** An allotment funded by moving money out of `sourceId`. */
export function transferredBudget(
  id: string,
  name: string,
  amount: number,
  sourceId: string,
  transactionId: string,
  startDate: string | null = null,
  endDate: string | null = startDate,
  overrides: Partial<Budget> = {},
): Budget {
  return budget(id, name, amount, startDate, endDate, {
    allocationType: "transferred",
    sourceBudgetId: sourceId,
    sourceTransactionId: transactionId,
    ...overrides,
  });
}

/** A general allotment: available whatever the expense date. */
export function generalBudget(
  id: string,
  name: string,
  amount: number,
  overrides: Partial<Budget> = {},
): Budget {
  return budget(id, name, amount, null, null, overrides);
}

export function expense(
  id: string,
  budgetId: string,
  name: string,
  amount: number,
  expenseDate: string,
  createdAt = `${expenseDate}T08:00:00.000Z`,
): Expense {
  return {
    id,
    budgetId,
    name,
    amount,
    expenseDate,
    kind: "expense",
    transferBudgetId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

/** A transfer transaction: money leaving `budgetId` for the allotment it made. */
export function transfer(
  id: string,
  budgetId: string,
  name: string,
  amount: number,
  expenseDate: string,
  transferBudgetId: string,
  createdAt = `${expenseDate}T08:00:00.000Z`,
): Expense {
  return {
    ...expense(id, budgetId, name, amount, expenseDate, createdAt),
    kind: "transfer",
    transferBudgetId,
  };
}
