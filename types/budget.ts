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
  /** The period has passed. The allotment can still be corrected. */
  | "period-ended"
  | "over-budget"
  /** A general allotment: available regardless of the date. */
  | "unrestricted"
  /**
   * Spent down to exactly ₱0.00 and closed. Outranks every other status: the
   * budget and its expenses are a historical record from that moment on.
   */
  | "fully-spent";

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
   *
   * A fully spent budget is locked too, but by `status` — that lock cannot be
   * lifted, and this flag has no say over it.
   */
  locked: boolean;
  /**
   * Lifecycle state, stored rather than derived.
   *
   * `"fully_spent"` is set once the remaining balance reaches exactly ₱0.00 and
   * is never cleared: the budget, and every expense charged to it, become an
   * immutable record. Recomputing this from the numbers would let a later edit
   * quietly reopen a closed budget, so the transition is written down.
   */
  status: BudgetLifecycle;
  /** When the budget was closed; `null` while it is still active. */
  completedAt: string | null;
  /** Whether the user allotted this money directly or moved it here. */
  allocationType: BudgetAllocation;
  /** The allotment this money came from; `null` for a direct allotment. */
  sourceBudgetId: string | null;
  /** The transfer transaction that funded it; `null` for a direct allotment. */
  sourceTransactionId: string | null;
}

/**
 * Where a budget's money came from.
 *
 * `"transferred"` money is not new money — it was already allotted to the
 * source and has only moved. Totals that add allotments together count the
 * direct ones only, or the same pesos would appear twice.
 */
export type BudgetAllocation = "direct" | "transferred";

/** The persisted lifecycle state of a budget. Mirrors the `status` column. */
export type BudgetLifecycle = "active" | "fully_spent";

/** Fields the user supplies when creating or editing a budget. */
export interface BudgetInput {
  name: string;
  amount: number;
  startDate: DateKey | null;
  endDate: DateKey | null;
}

/**
 * Moving money from one allotment into a new one.
 *
 * The amount and the date describe the transaction taken out of the source;
 * the name and the period describe the allotment it creates.
 */
export interface TransferInput {
  /** The allotment the money leaves. */
  sourceBudgetId: string;
  amount: number;
  /** The day the transfer is recorded against the source. */
  expenseDate: DateKey;
  /** Name of the allotment being created. */
  name: string;
  startDate: DateKey | null;
  endDate: DateKey | null;
}

/** Derived, never-persisted view of one budget's finances. */
export interface BudgetSummary {
  budget: Budget;
  /** Money actually spent from this budget. Transfers are not spending. */
  totalExpenses: number;
  /** Money moved out of this budget into other allotments. */
  totalTransferred: number;
  /** Everything that has left the budget: `totalExpenses + totalTransferred`. */
  totalDeducted: number;
  /** `amount - totalDeducted`. Negative when overspent. */
  remaining: number;
  /** Number of ordinary expenses. Transfers are counted separately. */
  expenseCount: number;
  transferCount: number;
  status: BudgetStatus;
  applicability: BudgetApplicability;
  /** Fraction of the allotment consumed, clamped to 0–1. */
  spentRatio: number;
  isOverspent: boolean;
  /** Days in the period, inclusive. `null` when there is no date restriction. */
  durationDays: number | null;
}
