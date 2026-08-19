/**
 * Budget allotment types.
 *
 * A budget allotment is an independent source of funds: its own name, its own
 * amount, and its own expenses. It is not a label on a shared pot — one
 * budget's spending never touches another's balance.
 *
 * An allotment is either tied to the calendar or not:
 *
 *   startDate = "2026-08-01", endDate = "2026-08-05"  → applies Aug 1–5
 *   startDate = endDate = "2026-08-19"                → applies that day only
 *   startDate = null,        endDate = null           → no date restriction
 *
 * Null is the *only* representation of "no date restriction". Sentinel dates
 * such as 1900-01-01 are deliberately not used: they would sort, filter and
 * print as if they were real days.
 */

import type { DateKey } from "@/lib/dates";

export type BudgetStatus =
  | "active"
  | "upcoming"
  | "completed"
  | "over-budget"
  /** A general allotment: available regardless of the date. */
  | "unrestricted";

/** How a budget relates to the calendar. */
export type BudgetApplicability = "single" | "range" | "general";

export interface Budget {
  /** Stable identifier. Expenses reference this, never the name, so renaming is safe. */
  id: string;
  /** User-supplied label, e.g. "Food Budget". Never generated. */
  name: string;
  /** Allotted amount in pesos. */
  amount: number;
  /** First day the budget applies, inclusive. `null` for a general allotment. */
  startDate: DateKey | null;
  /**
   * Last day the budget applies, inclusive. Equals `startDate` for a single
   * day, and is `null` exactly when `startDate` is.
   */
  endDate: DateKey | null;
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
  startDate: DateKey | null;
  endDate: DateKey | null;
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
  applicability: BudgetApplicability;
  /** Fraction of the allotment consumed, clamped to 0–1. */
  spentRatio: number;
  isOverspent: boolean;
  /** Days in the period, inclusive. `null` when there is no date restriction. */
  durationDays: number | null;
}
