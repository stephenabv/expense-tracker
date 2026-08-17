/**
 * Historical tracker types.
 *
 * A `HistoryDay` is an immutable snapshot of one calendar day. Once that day has
 * passed the record is sealed and is never recomputed — editing today's budget
 * or deleting an old expense must not rewrite what a past day reported.
 */

import type { Expense } from "@/types/expense";

/** A local calendar date as `YYYY-MM-DD`. */
export type DateKey = string;

export interface HistoryDay {
  /** Local calendar date this record covers. */
  date: DateKey;
  /** Budget allotment in effect on that day. */
  budget: number;
  /** Balance carried into the day, before its own expenses. */
  startingBalance: number;
  /** Balance at the end of the day: `startingBalance - totalExpenses`. */
  endingBalance: number;
  /** Sum of that day's expenses only. */
  totalExpenses: number;
  /** Frozen copies of the expenses recorded that day, newest first. */
  expenses: Expense[];
}

/** The active filter driving the history view and any export. */
export type HistoryFilter =
  | { mode: "all" }
  | { mode: "single"; date: DateKey }
  | { mode: "range"; start: DateKey; end: DateKey };

/** Named shortcuts offered alongside the date inputs. */
export type HistoryPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "thisMonth"
  | "lastMonth"
  | "all";

/**
 * Aggregate figures for the selected period.
 *
 * `startingBudget` and `endingBalance` are read from the recorded snapshots
 * rather than recomputed from today's budget, so a report stays accurate after
 * the budget changes.
 */
export interface HistorySummary {
  /** Budget recorded on the earliest day in range. */
  startingBudget: number;
  /** Balance carried into the earliest day in range. */
  startingBalance: number;
  /** Balance recorded at the end of the latest day in range. */
  endingBalance: number;
  /** Sum of the daily totals inside the range only. */
  totalExpenses: number;
  /** Number of individual expenses inside the range. */
  expenseCount: number;
  /** Days in range that actually have a record. */
  activeDays: number;
  /** Earliest date in range, or `null` when the range is empty. */
  firstDate: DateKey | null;
  /** Latest date in range, or `null` when the range is empty. */
  lastDate: DateKey | null;
}
