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
 * "Fully spent" outranks everything: once an allotment is closed, what its
 * calendar says stopped mattering. Overspending comes next — a budget past its
 * allotment says so whether it is running, finished, or general.
 *
 * A general allotment's period never ends — no amount of calendar drift retires
 * it. It stays available until the user changes or deletes it.
 */
export function budgetStatus(
  budget: Budget,
  expenses: Expense[],
  now: Date = new Date(),
): BudgetStatus {
  if (isFullySpent(budget)) return "fully-spent";
  if (calculateBudgetRemaining(budget, expenses) < 0) return "over-budget";
  if (isGeneralBudget(budget)) return "unrestricted";

  const today = todayKey(now);
  if (today < budget.startDate!) return "upcoming";
  if (today > budget.endDate!) return "period-ended";
  return "active";
}

/**
 * True when the budget has been spent down to exactly ₱0.00 and closed.
 *
 * Read from the stored lifecycle, never recomputed from the balance: the
 * balance is what the numbers say today, while this is what happened to the
 * budget. Deriving it would mean a later edit to the allotment could silently
 * reopen a record that is meant to be final.
 */
export function isFullySpent(budget: Pick<Budget, "status">): boolean {
  return budget.status === "fully_spent";
}

/**
 * True once the period has ended.
 *
 * General allotments have no period, so this is never true for them.
 */
export function isPeriodEnded(budget: Budget, now: Date = new Date()): boolean {
  if (isGeneralBudget(budget)) return false;
  return todayKey(now) > budget.endDate!;
}

/** True when the budget can fund an expense dated today. */
export function isActive(budget: Budget, now: Date = new Date()): boolean {
  return !isFullySpent(budget) && coversDate(budget, todayKey(now));
}

/** Open allotments: everything that has not been spent out. */
export function activeBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter((budget) => !isFullySpent(budget));
}

/** Closed allotments, newest completion first — the archive. */
export function completedBudgets(budgets: Budget[]): Budget[] {
  return budgets
    .filter(isFullySpent)
    .sort(
      (a, b) =>
        (b.completedAt ?? "").localeCompare(a.completedAt ?? "") ||
        a.id.localeCompare(b.id),
    );
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

/** One budget's spend, as counted by the database. */
export interface BudgetTotals {
  budgetId: string;
  totalExpenses: number;
  expenseCount: number;
}

/**
 * The same summary, built from an aggregate instead of the rows.
 *
 * This is what lets the expense list be paginated. `summarizeBudget` needs
 * every expense in memory to add them up; here the sum arrives already computed
 * from SQL, so a balance costs one small row per budget however many thousands
 * of expenses sit behind it. The arithmetic is identical — only the source of
 * the total differs.
 */
export function summarizeBudgetFromTotals(
  budget: Budget,
  totals: BudgetTotals | undefined,
  now: Date = new Date(),
): BudgetSummary {
  const totalExpenses = roundCurrency(totals?.totalExpenses ?? 0);
  const remaining = roundCurrency(budget.amount - totalExpenses);

  return {
    budget,
    totalExpenses,
    remaining,
    expenseCount: totals?.expenseCount ?? 0,
    // Status needs to know only whether this budget is overspent, which the
    // total already answers — so no expense rows are required here either.
    status: isFullySpent(budget)
      ? "fully-spent"
      : remaining < 0
        ? "over-budget"
        : isGeneralBudget(budget)
          ? "unrestricted"
          : todayKey(now) < budget.startDate!
            ? "upcoming"
            : todayKey(now) > budget.endDate!
              ? "period-ended"
              : "active",
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

export function summarizeBudgetsFromTotals(
  budgets: Budget[],
  totals: BudgetTotals[],
  now: Date = new Date(),
): BudgetSummary[] {
  const byId = new Map(totals.map((entry) => [entry.budgetId, entry]));
  return budgets.map((budget) =>
    summarizeBudgetFromTotals(budget, byId.get(budget.id), now),
  );
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
    // A fully spent allotment has nothing left to give, so it is not merely
    // hidden from the picker — it is not an option anywhere, at any date.
    .filter((budget) => !isFullySpent(budget) && coversDate(budget, date))
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
  return budgets.filter((budget) => isGeneralBudget(budget) && !isFullySpent(budget));
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
    .filter(
      (budget) =>
        budget.id !== excludeId &&
        !isGeneralBudget(budget) &&
        // A closed budget cannot take new expenses, so its period cannot clash
        // with anything the user is about to create.
        !isFullySpent(budget),
    )
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

/** The word shown for a closed budget, in every surface that names the state. */
export const FULLY_SPENT_LABEL = "Fully Spent";

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  // "Completed" is reserved for a budget that was spent out; a budget whose
  // dates have simply passed is a different thing and says so.
  "period-ended": "Period ended",
  "over-budget": "Over budget",
  unrestricted: NO_DATE_LABEL,
  "fully-spent": FULLY_SPENT_LABEL,
};
