/**
 * Expense types.
 *
 * The persisted shape is deliberately minimal: only source-of-truth values are
 * stored. Everything derivable (totals, balances) is computed in
 * `lib/calculations.ts` so the UI can never drift from the records.
 */

import type { DateKey } from "@/lib/dates";

/**
 * What a transaction actually is.
 *
 * `"expense"` is money consumed. `"transfer"` is money moved into a new
 * allotment — the source's balance drops by the same amount either way, but
 * only the first is spending. Everything that reports what a person *spent*
 * filters on this, which is what stops a transfer from being counted twice:
 * once as an expense and again as the destination's budget.
 */
export type ExpenseKind = "expense" | "transfer";

export interface Expense {
  /** Stable unique identifier. */
  id: string;
  /** The budget this expense is charged against. Referenced by id so that
   *  renaming a budget cannot break the association. */
  budgetId: string;
  /** Human-readable label, e.g. "Food". */
  name: string;
  /** Positive amount in the major currency unit (pesos). */
  amount: number;
  /** The calendar day the expense is for. This — not `createdAt` — decides
   *  which budget applies, so a user can record yesterday's lunch today. */
  expenseDate: DateKey;
  /** When the record was first created. */
  createdAt: string;
  /** When the record was last modified. */
  updatedAt: string;
  /** Whether this is spending or a move into another allotment. */
  kind: ExpenseKind;
  /**
   * For a transfer: the allotment this transaction created.
   *
   * Read back from the destination budget rather than stored twice, so the two
   * cannot drift. `null` for an ordinary expense.
   */
  transferBudgetId: string | null;
}

/** Fields a user supplies when creating or editing an expense. */
export interface ExpenseInput {
  name: string;
  amount: number;
  expenseDate: DateKey;
  budgetId: string;
}
