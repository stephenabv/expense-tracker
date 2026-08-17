/**
 * Budget allotment types.
 *
 * A budget allotment is an independent financial period: its own name, its own
 * amount, its own inclusive date range, and its own expenses. It is not a label
 * on a shared pot — one budget's spending never touches another's balance.
 */

import type { DateKey } from "@/lib/dates";

export type BudgetStatus = "active" | "upcoming" | "completed" | "over-budget";

export interface Budget {
  /** Stable identifier. Expenses reference this, never the name, so renaming is safe. */
  id: string;
  /** User-supplied label, e.g. "Food Budget". Never generated. */
  name: string;
  /** Allotted amount in pesos. */
  amount: number;
  /** First day the budget applies, inclusive. */
  startDate: DateKey;
  /** Last day the budget applies, inclusive. Equals `startDate` for a single day. */
  endDate: DateKey;
  createdAt: string;
  updatedAt: string;
  /**
   * Amount and dates are read-only until the user explicitly unlocks the budget.
   * Tracked per budget, so unlocking one leaves the others protected.
   */
  locked: boolean;
}

/** Fields the user supplies when creating or editing a budget. */
export interface BudgetInput {
  name: string;
  amount: number;
  startDate: DateKey;
  endDate: DateKey;
}

/** Derived, never-persisted view of one budget's finances. */
export interface BudgetSummary {
  budget: Budget;
  /** Sum of the expenses assigned to this budget. */
  totalExpenses: number;
  /** `amount - totalExpenses`. Negative when overspent. */
  remaining: number;
  expenseCount: number;
  status: BudgetStatus;
  /** Fraction of the allotment consumed, clamped to 0–1. */
  spentRatio: number;
  isOverspent: boolean;
  /** Days in the period, inclusive. */
  durationDays: number;
}
