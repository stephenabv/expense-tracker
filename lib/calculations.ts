/**
 * The single source of financial truth.
 *
 * Every number the dashboard shows flows through these functions, which is what
 * guarantees the displayed balance can never disagree with the expense records.
 *
 *   Current Balance = Budget Allotment - Sum(All Expenses)
 */

import type { Expense, TrackerState, TrackerTotals } from "@/types/expense";
import { roundCurrency } from "@/lib/currency";

/** Sum of every recorded expense. */
export function calculateTotalExpenses(expenses: Expense[]): number {
  if (!Array.isArray(expenses)) return 0;

  const totalCentavos = expenses.reduce((sum, expense) => {
    const amount = Number(expense?.amount);
    if (!Number.isFinite(amount)) return sum;
    return sum + Math.round(amount * 100);
  }, 0);

  return roundCurrency(totalCentavos / 100);
}

/** The core business rule. */
export function calculateBalance(budget: number, totalExpenses: number): number {
  const safeBudget = Number.isFinite(budget) ? budget : 0;
  const safeTotal = Number.isFinite(totalExpenses) ? totalExpenses : 0;
  return roundCurrency(safeBudget - safeTotal);
}

/** Derives the full dashboard view from persisted state. */
export function calculateTotals(state: TrackerState): TrackerTotals {
  const budget = Number.isFinite(state.budget) ? (state.budget as number) : 0;
  const totalExpenses = calculateTotalExpenses(state.expenses);
  const currentBalance = calculateBalance(budget, totalExpenses);

  const spentRatio =
    budget > 0 ? Math.min(Math.max(totalExpenses / budget, 0), 1) : 0;

  return {
    budget,
    totalExpenses,
    currentBalance,
    expenseCount: state.expenses.length,
    spentRatio,
    isOverspent: currentBalance < 0,
  };
}

/**
 * Balance available for a new expense.
 *
 * When editing, the expense being replaced is excluded so its own amount does
 * not count against the user twice.
 */
export function calculateAvailableBalance(
  state: TrackerState,
  excludeExpenseId?: string,
): number {
  const budget = Number.isFinite(state.budget) ? (state.budget as number) : 0;
  const relevant = excludeExpenseId
    ? state.expenses.filter((expense) => expense.id !== excludeExpenseId)
    : state.expenses;

  return calculateBalance(budget, calculateTotalExpenses(relevant));
}

/** Newest expense first; ties broken by id so the order is always stable. */
export function sortExpensesByNewest(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    const aValid = Number.isNaN(aTime) ? 0 : aTime;
    const bValid = Number.isNaN(bTime) ? 0 : bTime;

    if (aValid !== bValid) return bValid - aValid;
    return b.id.localeCompare(a.id);
  });
}
