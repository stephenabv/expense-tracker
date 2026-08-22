/**
 * Input validation for budgets and expenses.
 *
 * Pure and framework-free, so the same rules can be reused by a future server
 * without touching the UI.
 */

import type { Budget, BudgetApplicability } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { MAX_AMOUNT, formatCurrency, parseAmount } from "@/lib/currency";
import { isValidDateKey, type DateKey } from "@/lib/dates";

export const MAX_NAME_LENGTH = 60;
export const MAX_BUDGET_NAME_LENGTH = 40;

/**
 * Overdraft policy.
 *
 * The product blocks any expense that would push a budget below zero. Expressed
 * as an option rather than a hardcoded rule so overdraft support can be enabled
 * later without reworking the validators or the forms.
 */
export const ALLOW_OVERDRAFT_BY_DEFAULT = false;

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/* ------------------------------------------------------------------ budgets */

export function validateBudgetName(input: string): ValidationResult<string> {
  const trimmed = input.trim();

  // Never invent a name — an unnamed budget is a validation error.
  if (trimmed === "") {
    return { ok: false, error: "Give this budget a name." };
  }

  if (trimmed.length > MAX_BUDGET_NAME_LENGTH) {
    return {
      ok: false,
      error: `Keep the name under ${MAX_BUDGET_NAME_LENGTH} characters.`,
    };
  }

  return { ok: true, value: trimmed };
}

export function validateBudgetAmount(input: string): ValidationResult<number> {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter a budget amount." };

  const value = parseAmount(trimmed);
  if (value === null) {
    return { ok: false, error: "Enter a valid number, e.g. 5000." };
  }
  if (value < 0) return { ok: false, error: "Budget cannot be negative." };
  if (value > MAX_AMOUNT) {
    return { ok: false, error: `Budget cannot exceed ${formatCurrency(MAX_AMOUNT)}.` };
  }

  return { ok: true, value };
}

export interface BudgetPeriodResult {
  ok: boolean;
  error?: string;
  value?: { startDate: DateKey | null; endDate: DateKey | null };
}

/**
 * Validates a budget period for the chosen applicability.
 *
 * A single-day budget is expressed as `startDate === endDate`; a general
 * allotment as two nulls. Whatever the date inputs happen to hold is ignored
 * for a general budget — the user may have typed dates before switching the
 * mode, and storing them would silently restrict the allotment.
 */
export function validateBudgetPeriod(
  applicability: BudgetApplicability,
  startDate: string,
  endDate: string,
): BudgetPeriodResult {
  if (applicability === "general") {
    return { ok: true, value: { startDate: null, endDate: null } };
  }

  if (!isValidDateKey(startDate)) {
    return {
      ok: false,
      error:
        applicability === "single"
          ? "Choose a valid date."
          : "Choose valid start and end dates.",
    };
  }

  if (applicability === "single") {
    return { ok: true, value: { startDate, endDate: startDate } };
  }

  if (!isValidDateKey(endDate)) {
    return { ok: false, error: "Choose valid start and end dates." };
  }

  if (startDate > endDate) {
    return { ok: false, error: "The start date must be on or before the end date." };
  }

  return { ok: true, value: { startDate, endDate } };
}

export interface BudgetFormErrors {
  name?: string;
  amount?: string;
  period?: string;
}

export interface BudgetFormResult {
  ok: boolean;
  values?: {
    name: string;
    amount: number;
    startDate: DateKey | null;
    endDate: DateKey | null;
  };
  errors: BudgetFormErrors;
}

/**
 * Validates the whole budget form.
 *
 * Overlapping periods are *not* rejected. Every expense now names the budget it
 * is charged to, so two allotments covering the same day is a choice the user
 * makes at entry time rather than an ambiguity the data model cannot express —
 * and a general allotment, which covers every day, would be impossible under a
 * no-overlap rule. `findOverlaps` still reports clashes so the form can mention
 * them; it just no longer blocks.
 */
export function validateBudgetForm(
  name: string,
  amount: string,
  applicability: BudgetApplicability,
  startDate: string,
  endDate: string,
): BudgetFormResult {
  const nameResult = validateBudgetName(name);
  const amountResult = validateBudgetAmount(amount);
  const periodResult = validateBudgetPeriod(applicability, startDate, endDate);

  const errors: BudgetFormErrors = {};
  if (!nameResult.ok) errors.name = nameResult.error;
  if (!amountResult.ok) errors.amount = amountResult.error;
  if (!periodResult.ok) errors.period = periodResult.error;

  if (errors.name || errors.amount || errors.period) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name: nameResult.value!,
      amount: amountResult.value!,
      startDate: periodResult.value!.startDate,
      endDate: periodResult.value!.endDate,
    },
    errors,
  };
}

/* ------------------------------------------------------------------ merges */

export interface MergeFormErrors {
  name?: string;
  sources?: string;
}

export interface MergeFormResult {
  ok: boolean;
  values?: { name: string; sourceBudgetIds: [string, string] };
  errors: MergeFormErrors;
}

/**
 * Validates a budget merge.
 *
 * Only the name is checked, because only the name is the user's to give. The
 * amount and the period are derived from the two sources — a merge that let
 * either be typed in could quietly change how much money exists, which is the
 * one thing a merge must never do.
 */
export function validateMergeForm(
  name: string,
  sourceBudgetIds: string[],
  eligible: Budget[],
): MergeFormResult {
  const errors: MergeFormErrors = {};

  const chosen = sourceBudgetIds.filter((id) => id.trim() !== "");
  const unique = [...new Set(chosen)];

  if (unique.length !== 2) {
    errors.sources = "Choose exactly two budget allotments to merge.";
  } else if (!unique.every((id) => eligible.some((budget) => budget.id === id))) {
    errors.sources = "One of those allotments is no longer available to merge.";
  }

  const nameResult = validateBudgetName(name);
  if (!nameResult.ok) errors.name = nameResult.error;

  if (errors.name || errors.sources) return { ok: false, errors };

  return {
    ok: true,
    values: {
      name: nameResult.value!,
      sourceBudgetIds: [unique[0], unique[1]],
    },
    errors,
  };
}

/* ---------------------------------------------------------------- transfers */

export interface TransferFormErrors {
  name?: string;
  amount?: string;
  expenseDate?: string;
  sourceBudgetId?: string;
  period?: string;
}

export interface TransferFormResult {
  ok: boolean;
  values?: {
    name: string;
    amount: number;
    expenseDate: DateKey;
    sourceBudgetId: string;
    startDate: DateKey | null;
    endDate: DateKey | null;
  };
  errors: TransferFormErrors;
}

export interface TransferFormOptions {
  /**
   * Budgets that could fund a transfer on this date. A closed allotment is
   * never among them, so it cannot be named as a source.
   */
  eligibleBudgets: Budget[];
  /** What the chosen source has left. Omit to skip the balance check. */
  availableBalance?: number;
}

/**
 * Validates a budget transfer.
 *
 * A transfer is two things at once — a deduction from the source and a new
 * allotment — so both sets of rules apply. The amount is checked against the
 * source's balance exactly as an expense would be, because moving more money
 * than a budget holds is the same impossibility as spending it; the name and
 * the period are checked as a budget's, because that is what they become.
 */
export function validateTransferForm(
  name: string,
  amount: string,
  expenseDate: string,
  sourceBudgetId: string,
  applicability: BudgetApplicability,
  startDate: string,
  endDate: string,
  options: TransferFormOptions,
): TransferFormResult {
  const { eligibleBudgets, availableBalance } = options;

  // The destination is a budget, so its name follows a budget's rules.
  const nameResult = validateBudgetName(name);
  const amountResult = validateExpenseAmount(amount, { availableBalance });
  const dateResult = validateExpenseDate(expenseDate, eligibleBudgets);
  const periodResult = validateBudgetPeriod(applicability, startDate, endDate);

  const errors: TransferFormErrors = {};
  if (!nameResult.ok) errors.name = nameResult.error;
  if (!amountResult.ok) errors.amount = amountResult.error;
  if (!dateResult.ok) errors.expenseDate = dateResult.error;
  if (!periodResult.ok) errors.period = periodResult.error;

  if (dateResult.ok) {
    if (sourceBudgetId.trim() === "") {
      errors.sourceBudgetId = "Choose which budget allotment the money comes from.";
    } else if (!eligibleBudgets.some((budget) => budget.id === sourceBudgetId)) {
      errors.sourceBudgetId =
        "That budget allotment is not available for the selected date.";
    }
  }

  if (
    errors.name ||
    errors.amount ||
    errors.expenseDate ||
    errors.sourceBudgetId ||
    errors.period
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name: nameResult.value!,
      amount: amountResult.value!,
      expenseDate: dateResult.value!,
      sourceBudgetId,
      startDate: periodResult.value!.startDate,
      endDate: periodResult.value!.endDate,
    },
    errors,
  };
}

/* ----------------------------------------------------------------- expenses */

export function validateExpenseName(input: string): ValidationResult<string> {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Give this expense a name." };

  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Keep the name under ${MAX_NAME_LENGTH} characters.` };
  }

  return { ok: true, value: trimmed };
}

export interface ExpenseAmountOptions {
  /** Balance the expense is charged against. Omit to skip the overdraft check. */
  availableBalance?: number;
  allowOverdraft?: boolean;
}

export function validateExpenseAmount(
  input: string,
  options: ExpenseAmountOptions = {},
): ValidationResult<number> {
  const { availableBalance, allowOverdraft = ALLOW_OVERDRAFT_BY_DEFAULT } = options;

  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter an amount." };

  const value = parseAmount(trimmed);
  if (value === null) {
    return { ok: false, error: "Enter a valid number, e.g. 500." };
  }
  if (value <= 0) return { ok: false, error: "Amount must be greater than zero." };
  if (value > MAX_AMOUNT) {
    return { ok: false, error: `Amount cannot exceed ${formatCurrency(MAX_AMOUNT)}.` };
  }

  if (
    !allowOverdraft &&
    typeof availableBalance === "number" &&
    Number.isFinite(availableBalance) &&
    value > availableBalance
  ) {
    return {
      ok: false,
      error: `That exceeds this budget's available balance of ${formatCurrency(
        Math.max(availableBalance, 0),
      )}.`,
    };
  }

  return { ok: true, value };
}

/** Validates the expense date and that some budget could fund it. */
export function validateExpenseDate(
  date: string,
  eligibleBudgets: Budget[],
): ValidationResult<DateKey> {
  if (!isValidDateKey(date)) {
    return { ok: false, error: "Choose a valid date." };
  }

  if (eligibleBudgets.length === 0) {
    return {
      ok: false,
      error:
        "No budget allotment is available for this date. Create one before adding this expense.",
    };
  }

  return { ok: true, value: date };
}

export interface ExpenseFormErrors {
  name?: string;
  amount?: string;
  expenseDate?: string;
  budgetId?: string;
}

export interface ExpenseFormResult {
  ok: boolean;
  values?: {
    name: string;
    amount: number;
    expenseDate: DateKey;
    budgetId: string;
  };
  errors: ExpenseFormErrors;
}

export interface ExpenseFormOptions extends ExpenseAmountOptions {
  /**
   * Budgets that may fund this expense: those whose period covers the date,
   * plus every general allotment. Anything outside this list is not a valid
   * choice, whatever the client submitted.
   */
  eligibleBudgets: Budget[];
}

/**
 * Validates the whole expense form.
 *
 * An expense belongs to exactly one budget, and that budget is named
 * explicitly. The chosen id must be one the caller was actually offered, so a
 * request naming a budget for an unrelated date — or one the account does not
 * own, since the server passes only the user's own budgets — is refused rather
 * than being quietly reassigned.
 */
export function validateExpenseForm(
  name: string,
  amount: string,
  expenseDate: string,
  budgetId: string,
  options: ExpenseFormOptions,
): ExpenseFormResult {
  const { eligibleBudgets, ...amountOptions } = options;

  const nameResult = validateExpenseName(name);
  const amountResult = validateExpenseAmount(amount, amountOptions);
  const dateResult = validateExpenseDate(expenseDate, eligibleBudgets);

  const errors: ExpenseFormErrors = {};
  if (!nameResult.ok) errors.name = nameResult.error;
  if (!amountResult.ok) errors.amount = amountResult.error;
  if (!dateResult.ok) errors.expenseDate = dateResult.error;

  if (dateResult.ok) {
    if (budgetId.trim() === "") {
      errors.budgetId = "Choose which budget allotment this is deducted from.";
    } else if (!eligibleBudgets.some((budget) => budget.id === budgetId)) {
      errors.budgetId =
        "That budget allotment is not available for the selected date.";
    }
  }

  if (errors.name || errors.amount || errors.expenseDate || errors.budgetId) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      name: nameResult.value!,
      amount: amountResult.value!,
      expenseDate: dateResult.value!,
      budgetId,
    },
    errors,
  };
}

/** Expenses that would be stranded outside a budget's new period. */
export function describeStrandedExpenses(expenses: Expense[]): string {
  if (expenses.length === 0) return "";
  if (expenses.length === 1) return "1 recorded expense falls outside the new period.";
  return `${expenses.length} recorded expenses fall outside the new period.`;
}
