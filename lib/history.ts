/**
 * Historical tracker logic.
 *
 * The rule that shapes this whole module: **past days are sealed.** The record
 * for today is kept in step with the live tracker because the day is still being
 * written, but any earlier day is frozen exactly as it was recorded. Changing
 * today's budget, or deleting an expense from last week, must never alter what a
 * past day reported — otherwise an exported report would silently disagree with
 * the one printed yesterday.
 */

import type { Expense, TrackerState } from "@/types/expense";
import type {
  DateKey,
  HistoryDay,
  HistoryFilter,
  HistoryPreset,
  HistorySummary,
} from "@/types/history";
import { roundCurrency } from "@/lib/currency";
import { calculateTotalExpenses, sortExpensesByNewest } from "@/lib/calculations";

/** Formats a date as a local `YYYY-MM-DD` key (never UTC — days are local). */
export function toDateKey(value: Date | string): DateKey {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses a `YYYY-MM-DD` key into a local Date at midnight. */
export function fromDateKey(key: DateKey): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isValidDateKey(key: unknown): key is DateKey {
  return typeof key === "string" && fromDateKey(key) !== null;
}

const longDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** `August 17, 2026`. */
export function formatDateKey(key: DateKey): string {
  const date = fromDateKey(key);
  return date ? longDateFormatter.format(date) : key;
}

/** Human label for a filter, e.g. `August 1 – August 17, 2026`. */
export function describeFilter(filter: HistoryFilter): string {
  if (filter.mode === "all") return "All recorded history";
  if (filter.mode === "single") return formatDateKey(filter.date);

  if (filter.start === filter.end) return formatDateKey(filter.start);

  const start = fromDateKey(filter.start);
  const end = fromDateKey(filter.end);
  if (!start || !end) return `${filter.start} – ${filter.end}`;

  // Drop the repeated year when both ends share it.
  if (start.getFullYear() === end.getFullYear()) {
    const startLabel = new Intl.DateTimeFormat("en-PH", {
      month: "long",
      day: "numeric",
    }).format(start);
    return `${startLabel} – ${longDateFormatter.format(end)}`;
  }

  return `${longDateFormatter.format(start)} – ${longDateFormatter.format(end)}`;
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

  // Keys are zero-padded, so lexicographic order matches chronological order.
  if (filter.start > filter.end) {
    return "The start date must be on or before the end date.";
  }

  return null;
}

/** True when `date` falls inside the filter. Ranges include both endpoints. */
export function matchesFilter(date: DateKey, filter: HistoryFilter): boolean {
  if (filter.mode === "all") return true;
  if (filter.mode === "single") return date === filter.date;
  return date >= filter.start && date <= filter.end;
}

/** Groups expenses by the local calendar day they were recorded. */
export function groupExpensesByDate(
  expenses: Expense[],
): Map<DateKey, Expense[]> {
  const groups = new Map<DateKey, Expense[]>();

  for (const expense of expenses) {
    const key = toDateKey(expense.createdAt);
    if (!key) continue;

    const bucket = groups.get(key);
    if (bucket) bucket.push(expense);
    else groups.set(key, [expense]);
  }

  return groups;
}

/**
 * Builds the record for a single day from the live tracker.
 *
 * `endingBalance` counts every expense up to and including that day, matching
 * the tracker's core rule; `startingBalance` is what was left before the day's
 * own spending.
 */
function buildDayRecord(
  date: DateKey,
  budget: number,
  dayExpenses: Expense[],
  expensesUpToDate: Expense[],
): HistoryDay {
  const totalExpenses = calculateTotalExpenses(dayExpenses);
  const endingBalance = roundCurrency(
    budget - calculateTotalExpenses(expensesUpToDate),
  );

  return {
    date,
    budget: roundCurrency(budget),
    startingBalance: roundCurrency(endingBalance + totalExpenses),
    endingBalance,
    totalExpenses,
    // Frozen copies — later edits to the live expense must not reach in here.
    expenses: sortExpensesByNewest(dayExpenses).map((expense) => ({ ...expense })),
  };
}

/**
 * Rebuilds a full history from the live tracker.
 *
 * Used once, when a tracker that predates the history feature is first loaded:
 * today's budget is the only budget on record, so it is the best available basis
 * for those days. From then on days seal themselves as they pass.
 */
export function backfillHistory(
  state: TrackerState,
  now: Date = new Date(),
): HistoryDay[] {
  const budget = Number.isFinite(state.budget) ? (state.budget as number) : 0;
  const groups = groupExpensesByDate(state.expenses);
  const todayKey = toDateKey(now);

  const keys = [...groups.keys()].filter((key) => key <= todayKey).sort();

  return keys.map((key) => {
    const upToDate = state.expenses.filter(
      (expense) => toDateKey(expense.createdAt) <= key,
    );
    return buildDayRecord(key, budget, groups.get(key) ?? [], upToDate);
  });
}

/**
 * Brings the history up to date with the live tracker.
 *
 * Only today's record is written. Every earlier record is passed through
 * untouched, which is what makes historical reports stable.
 */
export function syncHistory(
  history: HistoryDay[],
  state: TrackerState,
  now: Date = new Date(),
): HistoryDay[] {
  const todayKey = toDateKey(now);
  if (!todayKey) return history;

  const budget = Number.isFinite(state.budget) ? (state.budget as number) : 0;
  const groups = groupExpensesByDate(state.expenses);

  // Everything before today is kept exactly as it was recorded.
  const sealed = new Map<DateKey, HistoryDay>(
    history.filter((day) => day.date < todayKey).map((day) => [day.date, day]),
  );

  // Self-healing: a past day that has expenses but was never recorded (storage
  // cleared, or an expense back-dated) gets a record now. Existing records are
  // never overwritten, so this can only add, never rewrite.
  for (const [key, dayExpenses] of groups) {
    if (key >= todayKey || sealed.has(key)) continue;

    const upToDate = state.expenses.filter(
      (expense) => toDateKey(expense.createdAt) <= key,
    );
    sealed.set(key, buildDayRecord(key, budget, dayExpenses, upToDate));
  }

  const records = [...sealed.values()];
  const todayExpenses = groups.get(todayKey) ?? [];

  // A day is only on record once something was spent. Inventing an empty record
  // would turn "no activity" into a misleading row of zeroes.
  if (todayExpenses.length === 0) return sortHistory(records);

  const expensesUpToToday = state.expenses.filter(
    (expense) => toDateKey(expense.createdAt) <= todayKey,
  );

  records.push(buildDayRecord(todayKey, budget, todayExpenses, expensesUpToToday));
  return sortHistory(records);
}

/** Oldest first — the canonical storage order. */
export function sortHistory(history: HistoryDay[]): HistoryDay[] {
  return [...history].sort((a, b) => a.date.localeCompare(b.date));
}

/** Applies a filter, returning matching days newest first for display. */
export function filterHistory(
  history: HistoryDay[],
  filter: HistoryFilter,
): HistoryDay[] {
  return history
    .filter((day) => matchesFilter(day.date, filter))
    .sort((a, b) => b.date.localeCompare(a.date));
}

const EMPTY_SUMMARY: HistorySummary = {
  startingBudget: 0,
  startingBalance: 0,
  endingBalance: 0,
  totalExpenses: 0,
  expenseCount: 0,
  activeDays: 0,
  firstDate: null,
  lastDate: null,
};

/**
 * Aggregates a set of days.
 *
 * Only the daily expense totals are summed. Budgets and balances are point-in-
 * time values — adding them across days would be meaningless — so the starting
 * figures come from the earliest day and the ending balance from the latest.
 */
export function summarizeHistory(days: HistoryDay[]): HistorySummary {
  if (days.length === 0) return { ...EMPTY_SUMMARY };

  const chronological = sortHistory(days);
  const first = chronological[0];
  const last = chronological[chronological.length - 1];

  const totalCentavos = chronological.reduce(
    (sum, day) => sum + Math.round(day.totalExpenses * 100),
    0,
  );

  return {
    startingBudget: first.budget,
    startingBalance: first.startingBalance,
    endingBalance: last.endingBalance,
    totalExpenses: roundCurrency(totalCentavos / 100),
    expenseCount: chronological.reduce((sum, day) => sum + day.expenses.length, 0),
    activeDays: chronological.length,
    firstDate: first.date,
    lastDate: last.date,
  };
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
