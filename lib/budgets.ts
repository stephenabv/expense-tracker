/**
 * Budget allotment logic.
 *
 * Two rules shape this module:
 *
 * 1. **Each budget is its own pot.** A budget's balance is its amount less the
 *    expenses assigned to *it*. No other budget can move that number.
 * 2. **Periods do not overlap.** Enforced when creating and editing, which is
 *    what lets an expense date resolve to exactly one budget with no guessing.
 */

import type { Budget, BudgetInput, BudgetStatus, BudgetSummary } from "@/types/budget";
import type { Expense } from "@/types/expense";
import {
  daysBetween,
  isWithinRange,
  overlapRange,
  rangesOverlap,
  todayKey,
  type DateKey,
} from "@/lib/dates";
import { roundCurrency } from "@/lib/currency";
import { calculateTotalExpenses } from "@/lib/calculations";

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
 * Overspending outranks the calendar: a budget that is over its allotment says
 * so whether it is still running or already finished.
 */
export function budgetStatus(
  budget: Budget,
  expenses: Expense[],
  now: Date = new Date(),
): BudgetStatus {
  if (calculateBudgetRemaining(budget, expenses) < 0) return "over-budget";

  const today = todayKey(now);
  if (today < budget.startDate) return "upcoming";
  if (today > budget.endDate) return "completed";
  return "active";
}

/** True once the period has ended. Completed budgets are immutable. */
export function isCompleted(budget: Budget, now: Date = new Date()): boolean {
  return todayKey(now) > budget.endDate;
}

/** True when the budget covers today. */
export function isActive(budget: Budget, now: Date = new Date()): boolean {
  return isWithinRange(todayKey(now), budget.startDate, budget.endDate);
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
    spentRatio:
      budget.amount > 0
        ? Math.min(Math.max(totalExpenses / budget.amount, 0), 1)
        : 0,
    isOverspent: remaining < 0,
    durationDays: daysBetween(budget.startDate, budget.endDate),
  };
}

export function summarizeBudgets(
  budgets: Budget[],
  expenses: Expense[],
  now: Date = new Date(),
): BudgetSummary[] {
  return budgets.map((budget) => summarizeBudget(budget, expenses, now));
}

/** Newest period first — the order budgets are listed in. */
export function sortBudgetsByPeriod(budgets: Budget[]): Budget[] {
  return [...budgets].sort((a, b) => {
    if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
    if (a.endDate !== b.endDate) return b.endDate.localeCompare(a.endDate);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Budgets whose period covers a date.
 *
 * Returns an array rather than a single budget: overlaps are prevented, but
 * data written before that rule (or edited by hand) could still contain them,
 * and the caller must be able to see the ambiguity rather than have one
 * silently picked for it.
 */
export function budgetsForDate(budgets: Budget[], date: DateKey): Budget[] {
  return budgets
    .filter((budget) => isWithinRange(date, budget.startDate, budget.endDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}

/** The budget covering a date, or `null` when none — or several — apply. */
export function resolveBudgetForDate(
  budgets: Budget[],
  date: DateKey,
): Budget | null {
  const matches = budgetsForDate(budgets, date);
  return matches.length === 1 ? matches[0] : null;
}

/** The budget covering today, if exactly one does. */
export function activeBudget(
  budgets: Budget[],
  now: Date = new Date(),
): Budget | null {
  return resolveBudgetForDate(budgets, todayKey(now));
}

export interface BudgetConflict {
  budget: Budget;
  /** The days the two periods share. */
  start: DateKey;
  end: DateKey;
}

/**
 * Existing budgets whose period would collide with the given range.
 *
 * `excludeId` skips the budget being edited so it never conflicts with itself.
 */
export function findOverlaps(
  budgets: Budget[],
  startDate: DateKey,
  endDate: DateKey,
  excludeId?: string,
): BudgetConflict[] {
  return budgets
    .filter((budget) => budget.id !== excludeId)
    .filter((budget) =>
      rangesOverlap(startDate, endDate, budget.startDate, budget.endDate),
    )
    .map((budget) => {
      const shared = overlapRange(
        startDate,
        endDate,
        budget.startDate,
        budget.endDate,
      )!;
      return { budget, start: shared.start, end: shared.end };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Expenses that a proposed period change would strand.
 *
 * Narrowing a budget's dates can leave expenses outside the period they are
 * charged to, so the form warns instead of quietly orphaning them.
 */
export function expensesOutsidePeriod(
  budget: Budget,
  expenses: Expense[],
  input: Pick<BudgetInput, "startDate" | "endDate">,
): Expense[] {
  return expensesForBudget(expenses, budget.id).filter(
    (expense) =>
      !isWithinRange(expense.expenseDate, input.startDate, input.endDate),
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
};
