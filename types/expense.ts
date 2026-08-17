/**
 * Core domain types.
 *
 * The persisted shape is deliberately minimal: only source-of-truth values are
 * stored. Everything derivable (total expenses, current balance) is computed in
 * `lib/calculations.ts` so the UI can never drift from the records.
 */

export interface Expense {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable label, e.g. "Food". */
  name: string;
  /** Positive amount in the major currency unit (pesos). */
  amount: number;
  /** ISO-8601 timestamp of when the expense was recorded. */
  createdAt: string;
}

/** Fields a user supplies when creating or editing an expense. */
export interface ExpenseInput {
  name: string;
  amount: number;
}

/**
 * The complete persisted application state.
 *
 * `budget` is `null` until the user configures one for the first time, which is
 * what drives the onboarding experience.
 */
export interface TrackerState {
  budget: number | null;
  expenses: Expense[];
}

/** Derived, never-persisted view of the financial state. */
export interface TrackerTotals {
  budget: number;
  totalExpenses: number;
  currentBalance: number;
  expenseCount: number;
  /** Fraction of the budget consumed, clamped to 0–1. `0` when budget is 0. */
  spentRatio: number;
  isOverspent: boolean;
}
