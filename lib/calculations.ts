/**
 * Money arithmetic.
 *
 * Every figure the app displays flows through these functions, which is what
 * guarantees the numbers on screen can never disagree with the records.
 *
 * Sums are accumulated in whole centavos so repeated addition never drifts.
 */

import type { Expense } from "@/types/expense";
import { roundCurrency } from "@/lib/currency";

/** Sum of the given expenses. */
export function calculateTotalExpenses(expenses: Expense[]): number {
  if (!Array.isArray(expenses)) return 0;

  const totalCentavos = expenses.reduce((sum, expense) => {
    const amount = Number(expense?.amount);
    if (!Number.isFinite(amount)) return sum;
    return sum + Math.round(amount * 100);
  }, 0);

  return roundCurrency(totalCentavos / 100);
}

/** Sums pre-rounded money values without accumulating float error. */
export function sumAmounts(values: number[]): number {
  const totalCentavos = values.reduce((sum, value) => {
    if (!Number.isFinite(value)) return sum;
    return sum + Math.round(value * 100);
  }, 0);
  return roundCurrency(totalCentavos / 100);
}

/**
 * The core rule, applied to one budget:
 *
 *   Budget Balance = Budget Amount - Total Associated Expenses
 */
export function calculateBalance(amount: number, totalExpenses: number): number {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeTotal = Number.isFinite(totalExpenses) ? totalExpenses : 0;
  return roundCurrency(safeAmount - safeTotal);
}

/**
 * Balance available for a new expense against a budget.
 *
 * When editing, the expense being replaced is excluded so its own amount is not
 * counted against the user twice.
 */
export function calculateAvailableBalance(
  budgetAmount: number,
  budgetExpenses: Expense[],
  excludeExpenseId?: string,
): number {
  const relevant = excludeExpenseId
    ? budgetExpenses.filter((expense) => expense.id !== excludeExpenseId)
    : budgetExpenses;

  return calculateBalance(budgetAmount, calculateTotalExpenses(relevant));
}

/** Newest expense first; ties broken by id so the order is always stable. */
export function sortExpensesByNewest(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => {
    // The calendar day the expense is *for* leads; the recording time only
    // breaks ties within a day.
    if (a.expenseDate !== b.expenseDate) {
      return b.expenseDate.localeCompare(a.expenseDate);
    }

    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    const aValid = Number.isNaN(aTime) ? 0 : aTime;
    const bValid = Number.isNaN(bTime) ? 0 : bTime;

    if (aValid !== bValid) return bValid - aValid;
    return b.id.localeCompare(a.id);
  });
}
