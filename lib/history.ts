/**
 * Historical reporting.
 *
 * History is derived from budgets and expenses on demand — see
 * `types/history.ts` for why that is safe now that completed budgets are
 * immutable.
 *
 * Balances chain *within* a budget, never across budgets: each allotment is its
 * own pot, so spending in one never moves another's running balance.
 */

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";
import type {
  HistoryBudgetSummary,
  HistoryDay,
  HistoryFilter,
  HistoryPreset,
  HistorySummary,
} from "@/types/history";
import {
  formatDateKey,
  formatDateRange,
  isValidDateKey,
  toDateKey,
  type DateKey,
} from "@/lib/dates";
import { roundCurrency } from "@/lib/currency";
import { calculateTotalExpenses, sortExpensesByNewest, sumAmounts } from "@/lib/calculations";
import {
  describeBudgetPeriodLong,
  expensesForBudget,
  isGeneralBudget,
  isSpending,
  isTransfer,
  sortBudgetsByPeriod,
  totalAllotted,
} from "@/lib/budgets";

/* ------------------------------------------------------------------ filters */

/** Human label for a filter, e.g. `August 1 – August 17, 2026`. */
export function describeFilter(filter: HistoryFilter): string {
  if (filter.mode === "all") return "All recorded history";
  if (filter.mode === "single") return formatDateKey(filter.date);
  return formatDateRange(filter.start, filter.end);
}

/** Validates a filter. Returns an error message, or `null` when it is usable. */
export function validateFilter(filter: HistoryFilter): string | null {
  if (filter.mode === "all") return null;

  if (filter.mode === "single") {
    return isValidDateKey(filter.date) ? null : "Choose a valid date.";
  }

  if (!isValidDateKey(filter.start) || !isValidDateKey(filter.end)) {
    return "Choose a valid start and end date.";
  }

  // Keys are zero-padded, so lexicographic order is chronological order.
  if (filter.start > filter.end) {
    return "The start date must be on or before the end date.";
  }

  return null;
}

/**
 * True when `date` falls inside the filter's period.
 *
 * Deliberately date-only: the budget half of the filter is applied where whole
 * records are available, since a date cannot say which budget it belongs to.
 */
export function matchesFilter(date: DateKey, filter: HistoryFilter): boolean {
  if (filter.mode === "all") return true;
  if (filter.mode === "single") return date === filter.date;
  return date >= filter.start && date <= filter.end;
}

/** Turns a named shortcut into a concrete filter. */
export function presetToFilter(
  preset: HistoryPreset,
  now: Date = new Date(),
): HistoryFilter {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const shiftDays = (days: number) => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return toDateKey(date);
  };

  switch (preset) {
    case "today":
      return { mode: "single", date: toDateKey(today) };

    case "yesterday":
      return { mode: "single", date: shiftDays(-1) };

    case "last7":
      // Inclusive of today, so six days back plus today.
      return { mode: "range", start: shiftDays(-6), end: toDateKey(today) };

    case "thisMonth":
      return {
        mode: "range",
        start: toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: toDateKey(today),
      };

    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      // Day 0 of this month is the last day of the previous one.
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { mode: "range", start: toDateKey(start), end: toDateKey(end) };
    }

    case "all":
    default:
      return { mode: "all" };
  }
}

/* ------------------------------------------------------------------ history */

/** Groups expenses by the calendar day they are recorded for. */
export function groupExpensesByDate(expenses: Expense[]): Map<DateKey, Expense[]> {
  const groups = new Map<DateKey, Expense[]>();

  for (const expense of expenses) {
    const key = expense.expenseDate;
    if (!isValidDateKey(key)) continue;

    const bucket = groups.get(key);
    if (bucket) bucket.push(expense);
    else groups.set(key, [expense]);
  }

  return groups;
}

/**
 * Builds the day-by-day record for every budget.
 *
 * Within a budget the balance chains forward through its own days; each budget
 * starts afresh from its own allotment. A day with no spending is not recorded —
 * inventing one would turn "no activity" into a misleading row of zeroes.
 */
export function buildHistory(
  budgets: Budget[],
  expenses: Expense[],
  /**
   * Spend that happened before the supplied expenses, per budget id.
   *
   * Supplied when only a window of history was fetched: without it a budget
   * would open the window at its full allotment, as though nothing had been
   * spent from it earlier.
   */
  spentBefore?: Map<string, number>,
): HistoryDay[] {
  const days: HistoryDay[] = [];

  for (const budget of budgets) {
    const own = expensesForBudget(expenses, budget.id);
    if (own.length === 0) continue;

    const groups = groupExpensesByDate(own);
    const dates = [...groups.keys()].sort();

    let running = roundCurrency(budget.amount - (spentBefore?.get(budget.id) ?? 0));

    for (const date of dates) {
      const dayExpenses = groups.get(date) ?? [];
      /*
       * Two figures, one balance.
       *
       * The chain has to fall by everything charged that day — a transfer took
       * the money out just as surely as a purchase did — but the reported
       * spend counts only what was actually spent, or the report would show a
       * purchase that never happened.
       */
      const totalExpenses = calculateTotalExpenses(dayExpenses.filter(isSpending));
      const totalTransferred = calculateTotalExpenses(dayExpenses.filter(isTransfer));
      const startingBalance = running;
      const endingBalance = roundCurrency(
        startingBalance - totalExpenses - totalTransferred,
      );
      running = endingBalance;

      days.push({
        date,
        budgetId: budget.id,
        budgetName: budget.name,
        budgetAmount: roundCurrency(budget.amount),
        budgetStartDate: budget.startDate,
        budgetEndDate: budget.endDate,
        budgetStatus: budget.status,
        allocationType: budget.allocationType,
        budgetFundedAmount: budget.fundedAmount,
        sourceBudgetId: budget.sourceBudgetId,
        startingBalance,
        endingBalance,
        totalExpenses,
        totalTransferred,
        expenses: sortExpensesByNewest(dayExpenses),
      });
    }
  }

  return sortHistoryDays(days);
}

/** Oldest first, then by budget — the canonical order. */
export function sortHistoryDays(days: HistoryDay[]): HistoryDay[] {
  return [...days].sort(
    (a, b) => a.date.localeCompare(b.date) || a.budgetId.localeCompare(b.budgetId),
  );
}

/**
 * Applies a filter, returning matching days newest first for display.
 *
 * Whatever this returns is exactly what the PDF prints, so the two can never
 * disagree about what the user asked for.
 */
export function filterHistory(
  days: HistoryDay[],
  filter: HistoryFilter,
): HistoryDay[] {
  const budgetId = filter.budgetId ?? null;

  return days
    .filter((day) => matchesFilter(day.date, filter))
    .filter((day) => budgetId === null || day.budgetId === budgetId)
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.budgetId.localeCompare(b.budgetId),
    );
}

/** Convenience: build and filter in one step. */
export function historyForFilter(
  budgets: Budget[],
  expenses: Expense[],
  filter: HistoryFilter,
): HistoryDay[] {
  return filterHistory(buildHistory(budgets, expenses), filter);
}

const EMPTY_SUMMARY: HistorySummary = {
  totalAllocated: 0,
  totalExpenses: 0,
  totalTransferred: 0,
  totalRemaining: 0,
  expenseCount: 0,
  activeDays: 0,
  budgetCount: 0,
  firstDate: null,
  lastDate: null,
  budgets: [],
};

/**
 * Aggregates the selected days.
 *
 * Per budget: expenses are summed across the period, while `remaining` is the
 * balance recorded on that budget's last in-range day — a point in time, not a
 * sum. Across budgets those independent pots are then added up.
 */
export function summarizeHistory(days: HistoryDay[]): HistorySummary {
  if (days.length === 0) return { ...EMPTY_SUMMARY };

  const chronological = sortHistoryDays(days);

  const byBudget = new Map<string, HistoryDay[]>();
  for (const day of chronological) {
    const bucket = byBudget.get(day.budgetId);
    if (bucket) bucket.push(day);
    else byBudget.set(day.budgetId, [day]);
  }

  const budgetSummaries: HistoryBudgetSummary[] = [...byBudget.values()].map(
    (budgetDays) => {
      const first = budgetDays[0];
      const last = budgetDays[budgetDays.length - 1];

      return {
        budgetId: first.budgetId,
        // The latest label wins, so a renamed budget reports under its current
        // name while every expense stays attached by id.
        budgetName: last.budgetName,
        budgetAmount: last.budgetAmount,
        budgetStartDate: last.budgetStartDate,
        budgetEndDate: last.budgetEndDate,
        budgetStatus: last.budgetStatus,
        allocationType: last.allocationType,
        fundedAmount: last.budgetFundedAmount,
        sourceBudgetId: last.sourceBudgetId,
        totalExpenses: sumAmounts(budgetDays.map((day) => day.totalExpenses)),
        totalTransferred: sumAmounts(budgetDays.map((day) => day.totalTransferred)),
        // The balance after the last day of this budget inside the range.
        remaining: last.endingBalance,
        expenseCount: budgetDays.reduce(
          (sum, day) => sum + day.expenses.filter(isSpending).length,
          0,
        ),
        transferCount: budgetDays.reduce(
          (sum, day) => sum + day.expenses.filter(isTransfer).length,
          0,
        ),
        activeDays: budgetDays.length,
        firstDate: first.date,
        lastDate: last.date,
      };
    },
  );

  budgetSummaries.sort(
    (a, b) => b.firstDate.localeCompare(a.firstDate) || a.budgetName.localeCompare(b.budgetName),
  );

  const distinctDates = new Set(chronological.map((day) => day.date));

  return {
    // Transferred allotments are left out: those pesos are already inside the
    // allocation of the budget they came from, and counting them twice would
    // report money the user never had.
    totalAllocated: totalAllotted(
      budgetSummaries.map((entry) => ({
        fundedAmount: entry.fundedAmount,
        status: entry.budgetStatus,
      })),
    ),
    totalExpenses: sumAmounts(budgetSummaries.map((entry) => entry.totalExpenses)),
    totalTransferred: sumAmounts(
      budgetSummaries.map((entry) => entry.totalTransferred),
    ),
    totalRemaining: sumAmounts(budgetSummaries.map((entry) => entry.remaining)),
    expenseCount: budgetSummaries.reduce((sum, entry) => sum + entry.expenseCount, 0),
    activeDays: distinctDates.size,
    budgetCount: budgetSummaries.length,
    firstDate: chronological[0].date,
    lastDate: chronological[chronological.length - 1].date,
    budgets: budgetSummaries,
  };
}

/**
 * Budgets that could have funded spending inside the filter, newest first.
 *
 * A general allotment has no period to intersect and is available on every
 * date, so it always qualifies.
 */
export function budgetsInFilter(
  budgets: Budget[],
  filter: HistoryFilter,
): Budget[] {
  const selected = filter.budgetId ?? null;
  const scoped =
    selected === null
      ? budgets
      : budgets.filter((budget) => budget.id === selected);

  if (filter.mode === "all") return sortBudgetsByPeriod(scoped);

  const start = filter.mode === "single" ? filter.date : filter.start;
  const end = filter.mode === "single" ? filter.date : filter.end;

  return sortBudgetsByPeriod(
    scoped.filter(
      (budget) =>
        isGeneralBudget(budget) ||
        (budget.startDate! <= end && start <= budget.endDate!),
    ),
  );
}

/**
 * Label for the budget half of a filter, for report metadata.
 *
 * Returns null when every budget is included, so callers can omit the line
 * rather than print "All budgets" where it adds nothing.
 */
export function describeBudgetFilter(
  budgets: Budget[],
  filter: HistoryFilter,
): string | null {
  const selected = filter.budgetId ?? null;
  if (selected === null) return null;

  const budget = budgets.find((entry) => entry.id === selected);
  if (!budget) return null;

  return `${budget.name} (${describeBudgetPeriodLong(budget)})`;
}
