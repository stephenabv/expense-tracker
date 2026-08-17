/** Shared fixtures for the domain tests. */

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";

export function budget(
  id: string,
  name: string,
  amount: number,
  startDate: string,
  endDate: string = startDate,
  overrides: Partial<Budget> = {},
): Budget {
  return {
    id,
    name,
    amount,
    startDate,
    endDate,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    locked: true,
    ...overrides,
  };
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
    createdAt,
    updatedAt: createdAt,
  };
}
