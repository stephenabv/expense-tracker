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
  BudgetAllocation,
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
import { calculateTotalExpenses, sumAmounts } from "@/lib/calculations";

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

/** Every transaction charged to one budget, transfers included. */
export function expensesForBudget(
  expenses: Expense[],
  budgetId: string,
): Expense[] {
  return expenses.filter((expense) => expense.budgetId === budgetId);
}

/** True for money that was spent, as opposed to moved to another allotment. */
export function isSpending(expense: Pick<Expense, "kind">): boolean {
  return expense.kind !== "transfer";
}

/** True for a transaction that moved money into a new allotment. */
export function isTransfer(expense: Pick<Expense, "kind">): boolean {
  return expense.kind === "transfer";
}

/** The allotments this budget's money was moved into. */
export function transfersFrom(expenses: Expense[], budgetId: string): Expense[] {
  return expensesForBudget(expenses, budgetId).filter(isTransfer);
}

/**
 * `Budget Balance = Budget Amount - everything charged to it`
 *
 * Both kinds count here. A transfer is not spending, but the money genuinely
 * left this allotment, so the balance has to fall by it — otherwise the same
 * pesos would be spendable from two budgets at once.
 */
export function calculateBudgetRemaining(
  budget: Budget,
  expenses: Expense[],
): number {
  const out = calculateTotalExpenses(expensesForBudget(expenses, budget.id));
  return roundCurrency(budget.amount - out);
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
  return statusFor(budget, calculateBudgetRemaining(budget, expenses), now);
}

/**
 * The status ladder, in one place.
 *
 * Both ways of summarising a budget need this — from its expense rows, and from
 * the totals SQL computed — and they once carried a copy each. Adding "merged"
 * to one of them and not the other put a folded-away allotment back under the
 * calendar rules, where it showed as "Period ended". A rule with two homes is a
 * rule that will disagree with itself.
 */
export function statusFor(
  budget: Pick<Budget, "status" | "startDate" | "endDate">,
  remaining: number,
  now: Date = new Date(),
): BudgetStatus {
  // A merged allotment no longer holds anything; what its old numbers say
  // stopped mattering the moment it was folded in.
  if (isMerged(budget)) return "merged";
  if (isFullySpent(budget)) return "fully-spent";
  if (remaining < 0) return "over-budget";
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
 * True when the allotment has been folded into another one.
 *
 * Permanent, like being fully spent, and locked just as firmly — but for a
 * different reason: the money was not consumed, it moved. Its expenses now
 * belong to the allotment it became part of, so its own live balance says
 * nothing; the record of what it held is the merge snapshot.
 */
export function isMerged(budget: Pick<Budget, "status">): boolean {
  return budget.status === "merged";
}

/**
 * True when the allotment is finished with, whichever way it ended.
 *
 * This is the question the working lists ask: a spent-out budget and a merged
 * one are both gone from the places you choose a budget, even though they are
 * gone for different reasons.
 */
export function isClosed(budget: Pick<Budget, "status">): boolean {
  return isFullySpent(budget) || isMerged(budget);
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
  return !isClosed(budget) && coversDate(budget, todayKey(now));
}

/**
 * True when this allotment was funded by moving money out of another one.
 *
 * Read from the stored allocation type, so the origin survives a rename of
 * either budget and any later spending from this one.
 */
export function isTransferred(budget: Pick<Budget, "allocationType">): boolean {
  return budget.allocationType === "transferred";
}

/** Allotments the user funded directly, rather than by moving money. */
export function directBudgets<T extends Pick<Budget, "allocationType">>(
  budgets: T[],
): T[] {
  return budgets.filter((budget) => !isTransferred(budget));
}

/**
 * How much money the user has actually put aside, across allotments.
 *
 * Transferred allotments are excluded on purpose. Their pesos were already
 * counted where they came from, so adding them again would report ₱12,000 for
 * a person who has ₱10,000 — the transfer would look like it created money.
 * The *remaining* balances still sum normally: the source's fell by exactly
 * what the destination's rose.
 */
export function totalAllotted(
  budgets: Array<Pick<Budget, "fundedAmount" | "status">>,
): number {
  return sumAmounts(
    budgets
      // A merged allotment's money is inside the one it became part of.
      .filter((budget) => !isMerged(budget))
      .map((budget) => budget.fundedAmount),
  );
}

/** The allotment this one's money came from, if any. */
export function sourceBudgetOf(
  budgets: Budget[],
  budget: Pick<Budget, "sourceBudgetId">,
): Budget | null {
  if (!budget.sourceBudgetId) return null;
  return budgets.find((entry) => entry.id === budget.sourceBudgetId) ?? null;
}

/** The allotments funded out of this one, oldest first. */
export function budgetsFundedBy(budgets: Budget[], budgetId: string): Budget[] {
  return budgets
    .filter((budget) => budget.sourceBudgetId === budgetId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** The allotment a transfer transaction created. */
export function budgetFromTransfer(
  budgets: Budget[],
  expense: Pick<Expense, "id" | "transferBudgetId">,
): Budget | null {
  const id = expense.transferBudgetId;
  if (!id) return null;
  return budgets.find((budget) => budget.id === id) ?? null;
}

/** Open allotments: everything not spent out and not merged away. */
export function activeBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter((budget) => !isClosed(budget));
}

/** Allotments folded into another, newest merge first. */
export function mergedBudgets(budgets: Budget[]): Budget[] {
  return budgets
    .filter(isMerged)
    .sort(
      (a, b) =>
        (b.mergedAt ?? "").localeCompare(a.mergedAt ?? "") ||
        a.id.localeCompare(b.id),
    );
}

/** The allotment this one was folded into, if any. */
export function mergedIntoBudget(
  budgets: Budget[],
  budget: Pick<Budget, "mergedIntoBudgetId">,
): Budget | null {
  if (!budget.mergedIntoBudgetId) return null;
  return budgets.find((entry) => entry.id === budget.mergedIntoBudgetId) ?? null;
}

/** The allotments folded into this one. */
export function budgetsMergedInto(budgets: Budget[], budgetId: string): Budget[] {
  return budgets
    .filter((budget) => budget.mergedIntoBudgetId === budgetId)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
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
  const spending = own.filter(isSpending);
  const moved = own.filter(isTransfer);

  const totalExpenses = calculateTotalExpenses(spending);
  const totalTransferred = calculateTotalExpenses(moved);
  const totalDeducted = roundCurrency(totalExpenses + totalTransferred);
  const remaining = roundCurrency(budget.amount - totalDeducted);

  return {
    budget,
    totalExpenses,
    totalTransferred,
    totalDeducted,
    remaining,
    expenseCount: spending.length,
    transferCount: moved.length,
    status: budgetStatus(budget, expenses, now),
    applicability: budgetApplicability(budget),
    // The bar shows how much of the allotment is gone, whichever way it went.
    spentRatio:
      budget.amount > 0
        ? Math.min(Math.max(totalDeducted / budget.amount, 0), 1)
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

/** One budget's outgoings, as counted by the database. */
export interface BudgetTotals {
  budgetId: string;
  /** Money spent. Transfers are excluded — they are not spending. */
  totalExpenses: number;
  /** Money moved out into other allotments. */
  totalTransferred: number;
  expenseCount: number;
  transferCount: number;
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
  const totalTransferred = roundCurrency(totals?.totalTransferred ?? 0);
  const totalDeducted = roundCurrency(totalExpenses + totalTransferred);
  const remaining = roundCurrency(budget.amount - totalDeducted);

  return {
    budget,
    totalExpenses,
    totalTransferred,
    totalDeducted,
    remaining,
    expenseCount: totals?.expenseCount ?? 0,
    transferCount: totals?.transferCount ?? 0,
    // Status needs to know only whether this budget is overspent, which the
    // total already answers — so no expense rows are required here either.
    status: statusFor(budget, remaining, now),
    applicability: budgetApplicability(budget),
    spentRatio:
      budget.amount > 0
        ? Math.min(Math.max(totalDeducted / budget.amount, 0), 1)
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
    // A closed allotment has nothing left to give — spent out or folded into
    // another — so it is not merely hidden from the picker; it is not an option
    // anywhere, at any date.
    .filter((budget) => !isClosed(budget) && coversDate(budget, date))
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
  return budgets.filter((budget) => isGeneralBudget(budget) && !isClosed(budget));
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
        !isClosed(budget),
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

/**
 * What a transfer is called on screen.
 *
 * "Budget Transfer" is what it is; from the source budget's point of view what
 * the user sees is money leaving for somewhere else, which is why the row in a
 * list reads as a deduction rather than as a purchase.
 */
export const TRANSFER_LABEL = "Budget Transfer";
export const TRANSFER_ROW_LABEL = "Deduction from Another Allotment";

/** How a budget's funding is described. */
export const ALLOCATION_LABELS: Record<BudgetAllocation, string> = {
  direct: "Direct",
  transferred: "Transferred",
};

/** What a folded-in allotment is called on screen. */
export const MERGED_LABEL = "Merged";

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  // "Completed" is reserved for a budget that was spent out; a budget whose
  // dates have simply passed is a different thing and says so.
  "period-ended": "Period ended",
  "over-budget": "Over budget",
  unrestricted: NO_DATE_LABEL,
  "fully-spent": FULLY_SPENT_LABEL,
  merged: MERGED_LABEL,
};
