/**
 * Budget allotment logic.
 *
 * Two rules shape this module:
 *
 * 1. **Each budget is its own pot.** A budget's balance is its amount less the
 *    expenses assigned to *it*. No other budget can move that number.
 * 2. **The expense names its budget.** Nothing here infers which allotment an
 *    expense belongs to; `budgetsForDate` only offers the *eligible* ones and
 *    the user picks. That is why periods are now allowed to overlap: ambiguity
 *    is resolved by the person recording the expense, not by a rule that has to
 *    guess.
 */

import type {
  Budget,
  BudgetApplicability,
  BudgetInput,
  BudgetStatus,
  BudgetSummary,
} from "@/types/budget";
import type { Expense } from "@/types/expense";
import {
  daysBetween,
  formatDateRange,
  formatShortDateRange,
  isWithinRange,
  overlapRange,
  rangesOverlap,
  todayKey,
  type DateKey,
} from "@/lib/dates";
import { roundCurrency } from "@/lib/currency";
import { calculateTotalExpenses } from "@/lib/calculations";

/** Shown wherever a general allotment's period would otherwise be blank. */
export const NO_DATE_LABEL = "No Date Restriction";

/** The same idea in the sentence-shaped places: forms, PDF metadata. */
export const NO_DATE_PERIOD_LABEL = "No Specific Date";

/* ------------------------------------------------------------ applicability */

/**
 * True when the allotment carries no date restriction.
 *
 * Either end being null makes the budget general — a half-set period is not a
 * meaningful range, and the database forbids storing one.
 */
export function isGeneralBudget(
  budget: Pick<Budget, "startDate" | "endDate">,
): boolean {
  return budget.startDate === null || budget.endDate === null;
}

export function budgetApplicability(
  budget: Pick<Budget, "startDate" | "endDate">,
): BudgetApplicability {
  if (isGeneralBudget(budget)) return "general";
  return budget.startDate === budget.endDate ? "single" : "range";
}

/**
 * True when this budget may fund an expense dated `date`.
 *
 * A general allotment funds any date; a date-based one funds only its own
 * inclusive period.
 */
export function coversDate(budget: Budget, date: DateKey): boolean {
  if (isGeneralBudget(budget)) return true;
  return isWithinRange(date, budget.startDate!, budget.endDate!);
}

/** `Aug 1 – Aug 5`, or the no-date label. Used on cards and rows. */
export function describeBudgetPeriod(
  budget: Pick<Budget, "startDate" | "endDate">,
): string {
  if (isGeneralBudget(budget)) return NO_DATE_LABEL;
  return formatShortDateRange(budget.startDate!, budget.endDate!);
}

/** `August 1 – August 5, 2026`, or the no-date label. Used in prose and PDFs. */
export function describeBudgetPeriodLong(
  budget: Pick<Budget, "startDate" | "endDate">,
): string {
  if (isGeneralBudget(budget)) return NO_DATE_PERIOD_LABEL;
  return formatDateRange(budget.startDate!, budget.endDate!);
}

/* ---------------------------------------------------------------- balances */

/** Expenses charged to one budget. */
export function expensesForBudget(
  expenses: Expense[],
  budgetId: string,
): Expense[] {
  return expenses.filter((expense) => expense.budgetId === budgetId);
}

/**
 * `Budget Balance = Budget Amount - Total Associated Expenses`
 *
 * Only this budget's own expenses are counted.
 */
export function calculateBudgetRemaining(
  budget: Budget,
  expenses: Expense[],
): number {
  const spent = calculateTotalExpenses(expensesForBudget(expenses, budget.id));
  return roundCurrency(budget.amount - spent);
}

/**
 * Status of a budget on a given day.
 *
 * Overspending outranks everything else: a budget past its allotment says so
 * whether it is running, finished, or general.
 *
 * A general allotment never becomes "completed" — no amount of calendar drift
 * retires it. It stays available until the user changes or deletes it.
 */
export function budgetStatus(
  budget: Budget,
  expenses: Expense[],
  now: Date = new Date(),
): BudgetStatus {
  if (calculateBudgetRemaining(budget, expenses) < 0) return "over-budget";
  if (isGeneralBudget(budget)) return "unrestricted";

  const today = todayKey(now);
  if (today < budget.startDate!) return "upcoming";
  if (today > budget.endDate!) return "completed";
  return "active";
}

/**
 * True once the period has ended. Completed budgets are immutable.
 *
 * General allotments are never completed, so they stay editable.
 */
export function isCompleted(budget: Budget, now: Date = new Date()): boolean {
  if (isGeneralBudget(budget)) return false;
  return todayKey(now) > budget.endDate!;
}

/** True when the budget can fund an expense dated today. */
export function isActive(budget: Budget, now: Date = new Date()): boolean {
  return coversDate(budget, todayKey(now));
}

/** Everything the UI needs about one budget, derived in one place. */
export function summarizeBudget(
  budget: Budget,
  expenses: Expense[],
  now: Date = new Date(),
): BudgetSummary {
  const own = expensesForBudget(expenses, budget.id);
  const totalExpenses = calculateTotalExpenses(own);
  const remaining = roundCurrency(budget.amount - totalExpenses);

  return {
    budget,
    totalExpenses,
    remaining,
    expenseCount: own.length,
    status: budgetStatus(budget, expenses, now),
    applicability: budgetApplicability(budget),
    spentRatio:
      budget.amount > 0
        ? Math.min(Math.max(totalExpenses / budget.amount, 0), 1)
        : 0,
    isOverspent: remaining < 0,
    durationDays: isGeneralBudget(budget)
      ? null
      : daysBetween(budget.startDate!, budget.endDate!),
  };
}

export function summarizeBudgets(
  budgets: Budget[],
  expenses: Expense[],
  now: Date = new Date(),
): BudgetSummary[] {
  return budgets.map((budget) => summarizeBudget(budget, expenses, now));
}

/**
 * Listing order: dated allotments newest period first, then the general ones.
 *
 * General budgets have no period to sort by, so they are ordered by creation
 * and kept together at the end rather than being scattered through the list.
 */
export function sortBudgetsByPeriod(budgets: Budget[]): Budget[] {
  return [...budgets].sort((a, b) => {
    const aGeneral = isGeneralBudget(a);
    const bGeneral = isGeneralBudget(b);
    if (aGeneral !== bGeneral) return aGeneral ? 1 : -1;

    if (aGeneral && bGeneral) {
      return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    }

    if (a.startDate !== b.startDate) {
      return b.startDate!.localeCompare(a.startDate!);
    }
    if (a.endDate !== b.endDate) return b.endDate!.localeCompare(a.endDate!);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Every budget that may fund an expense on `date`.
 *
 * Date-based allotments covering the day come first, general allotments after:
 * the specific budget is the likelier intent, and the general one is the
 * fallback. A budget covering an unrelated date is not returned at all, so it
 * can never be offered as an option.
 */
export function budgetsForDate(budgets: Budget[], date: DateKey): Budget[] {
  return budgets
    .filter((budget) => coversDate(budget, date))
    .sort((a, b) => {
      const aGeneral = isGeneralBudget(a);
      const bGeneral = isGeneralBudget(b);
      if (aGeneral !== bGeneral) return aGeneral ? 1 : -1;
      if (aGeneral && bGeneral) return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      return (
        a.startDate!.localeCompare(b.startDate!) || a.id.localeCompare(b.id)
      );
    });
}

/** General allotments, which are eligible whatever the expense date. */
export function generalBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter(isGeneralBudget);
}

/**
 * The single budget for a date, or `null` when the choice is not forced.
 *
 * Returning null for "several apply" is the point: with more than one eligible
 * allotment the user must say which pot pays, and nothing may pick for them.
 */
export function resolveBudgetForDate(
  budgets: Budget[],
  date: DateKey,
): Budget | null {
  const matches = budgetsForDate(budgets, date);
  return matches.length === 1 ? matches[0] : null;
}

/** Budgets that can fund an expense dated today. */
export function budgetsForToday(
  budgets: Budget[],
  now: Date = new Date(),
): Budget[] {
  return budgetsForDate(budgets, todayKey(now));
}

/** True when this budget can no longer fund an expense on the given date. */
export function needsReassignment(
  budget: Budget | null,
  date: DateKey,
): boolean {
  return budget !== null && !coversDate(budget, date);
}

export interface BudgetConflict {
  budget: Budget;
  /** The days the two periods share. */
  start: DateKey;
  end: DateKey;
}

/**
 * Existing dated budgets whose period would collide with the given range.
 *
 * Overlap is legal — the expense form asks which pot to use — so this is
 * advisory only, shown while the dates are being chosen. General allotments are
 * excluded: they apply to every day, so reporting them as a clash would flag
 * every budget the user ever creates.
 */
export function findOverlaps(
  budgets: Budget[],
  startDate: DateKey,
  endDate: DateKey,
  excludeId?: string,
): BudgetConflict[] {
  return budgets
    .filter((budget) => budget.id !== excludeId && !isGeneralBudget(budget))
    .filter((budget) =>
      rangesOverlap(startDate, endDate, budget.startDate!, budget.endDate!),
    )
    .map((budget) => {
      const shared = overlapRange(
        startDate,
        endDate,
        budget.startDate!,
        budget.endDate!,
      )!;
      return { budget, start: shared.start, end: shared.end };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Expenses that a proposed period change would strand.
 *
 * Narrowing a budget's dates can leave expenses outside the period they are
 * charged to, so the form warns instead of quietly orphaning them. Widening to
 * "no date restriction" strands nothing, because every date then qualifies.
 */
export function expensesOutsidePeriod(
  budget: Budget,
  expenses: Expense[],
  input: Pick<BudgetInput, "startDate" | "endDate">,
): Expense[] {
  if (isGeneralBudget(input)) return [];

  return expensesForBudget(expenses, budget.id).filter(
    (expense) =>
      !isWithinRange(expense.expenseDate, input.startDate!, input.endDate!),
  );
}

/** Expenses whose budget no longer exists — should never happen via the UI. */
export function orphanedExpenses(
  budgets: Budget[],
  expenses: Expense[],
): Expense[] {
  const ids = new Set(budgets.map((budget) => budget.id));
  return expenses.filter((expense) => !ids.has(expense.budgetId));
}

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  completed: "Completed",
  "over-budget": "Over budget",
  unrestricted: NO_DATE_LABEL,
};
