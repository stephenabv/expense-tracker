/**
 * Historical reporting types.
 *
 * History is *derived* from budgets and expenses rather than stored. That is
 * safe because a budget whose period has ended is immutable: its amount, dates
 * and name can no longer change, so any report over past dates is reproducible
 * from source data. Deriving also means an expense back-dated into a past day
 * shows up where it belongs, which a frozen daily snapshot would hide.
 */

import type { BudgetLifecycle } from "@/types/budget";
import type { DateKey } from "@/lib/dates";
import type { Expense } from "@/types/expense";

/** One calendar day's activity within one budget. */
export interface HistoryDay {
  date: DateKey;
  /**
   * The budget these expenses were charged to. The relationship is by id, so a
   * later rename changes the label the report prints without ever moving an
   * expense to a different pot.
   */
  budgetId: string;
  budgetName: string;
  budgetAmount: number;
  /** The budget's own applicable period; `null` when it has no date restriction. */
  budgetStartDate: DateKey | null;
  budgetEndDate: DateKey | null;
  /**
   * Whether the budget is still open or was spent out and closed.
   *
   * Carried into the report so a reader can tell a budget that still has room
   * from one that is finished — a ₱0.00 remaining balance alone does not say
   * which, and the two mean very different things.
   */
  budgetStatus: BudgetLifecycle;
  /** That budget's balance entering the day. */
  startingBalance: number;
  /** That budget's balance after the day: `startingBalance - totalExpenses`. */
  endingBalance: number;
  /** Sum of this day's expenses within this budget. */
  totalExpenses: number;
  /** Expenses recorded that day for that budget, newest first. */
  expenses: Expense[];
}

/**
 * The active filter driving the history view and any export.
 *
 * `budgetId` narrows the same selection to one allotment. It rides along with
 * the date modes rather than replacing them, because the two are independent:
 * a user can ask for "August 1–19" or "August 1–19, Emergency Fund only".
 */
export type HistoryFilter = (
  | { mode: "all" }
  | { mode: "single"; date: DateKey }
  | { mode: "range"; start: DateKey; end: DateKey }
) & {
  /** Restrict to one budget, by id. Omitted or null means every budget. */
  budgetId?: string | null;
};

export type HistoryPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "thisMonth"
  | "lastMonth"
  | "all";

/** One budget's figures within the selected period. */
export interface HistoryBudgetSummary {
  budgetId: string;
  budgetName: string;
  /** The budget's full allotment. */
  budgetAmount: number;
  /** The budget's own applicable period; `null` when unrestricted. */
  budgetStartDate: DateKey | null;
  budgetEndDate: DateKey | null;
  /** Open, or spent out and closed. */
  budgetStatus: BudgetLifecycle;
  /** Spend inside the selected period only. */
  totalExpenses: number;
  /** The budget's balance after the last in-range day. */
  remaining: number;
  expenseCount: number;
  activeDays: number;
  firstDate: DateKey;
  lastDate: DateKey;
}

/**
 * Aggregate figures for the selected period.
 *
 * Budgets are independent pots, so allotments and remaining balances are summed
 * across budgets — but never across days within a budget, where they are
 * point-in-time values.
 */
export interface HistorySummary {
  /** Sum of the allotments of every budget appearing in range. */
  totalAllocated: number;
  /** Sum of the expenses inside the range. */
  totalExpenses: number;
  /** Sum of each budget's remaining balance as of its last in-range day. */
  totalRemaining: number;
  expenseCount: number;
  /** Distinct calendar days with activity. */
  activeDays: number;
  budgetCount: number;
  firstDate: DateKey | null;
  lastDate: DateKey | null;
  /** Per-budget breakdown, newest period first. */
  budgets: HistoryBudgetSummary[];
}
