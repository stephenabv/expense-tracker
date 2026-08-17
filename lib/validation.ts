/**
 * Input validation for budgets and expenses.
 *
 * Pure and framework-free, so the same rules can be reused by a future server
 * without touching the UI.
 */

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { MAX_AMOUNT, formatCurrency, parseAmount } from "@/lib/currency";
import { formatDateRange, isValidDateKey, type DateKey } from "@/lib/dates";
import { findOverlaps } from "@/lib/budgets";

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
  value?: { startDate: DateKey; endDate: DateKey };
}

/**
 * Validates a budget period.
 *
 * A single-day budget is valid and is expressed as `startDate === endDate`.
 */
export function validateBudgetPeriod(
  startDate: string,
  endDate: string,
): BudgetPeriodResult {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
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
  values?: { name: string; amount: number; startDate: DateKey; endDate: DateKey };
  errors: BudgetFormErrors;
}

export interface BudgetFormOptions {
  /** Existing budgets, used for the overlap check. */
  budgets?: Budget[];
  /** Id of the budget being edited, so it never conflicts with itself. */
  excludeId?: string;
}

/**
 * Validates the whole budget form.
 *
 * Overlapping periods are rejected outright. Allowing them would mean an
 * expense date could match two budgets, and the app would have to either guess
 * or interrogate the user on every entry — the overlap is blocked at the one
 * place where the user can still fix it cheaply.
 */
export function validateBudgetForm(
  name: string,
  amount: string,
  startDate: string,
  endDate: string,
  options: BudgetFormOptions = {},
): BudgetFormResult {
  const { budgets = [], excludeId } = options;

  const nameResult = validateBudgetName(name);
  const amountResult = validateBudgetAmount(amount);
  const periodResult = validateBudgetPeriod(startDate, endDate);

  const errors: BudgetFormErrors = {};
  if (!nameResult.ok) errors.name = nameResult.error;
  if (!amountResult.ok) errors.amount = amountResult.error;
  if (!periodResult.ok) errors.period = periodResult.error;

  if (periodResult.ok) {
    const conflicts = findOverlaps(
      budgets,
      periodResult.value!.startDate,
      periodResult.value!.endDate,
      excludeId,
    );

    if (conflicts.length > 0) {
      const first = conflicts[0];
      errors.period =
        `This overlaps "${first.budget.name}" ` +
        `(${formatDateRange(first.start, first.end)}). ` +
        `Budgets cannot share dates — adjust the period.`;
    }
  }

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

/** Validates the expense date and that a budget was chosen for it. */
export function validateExpenseDate(
  date: string,
  applicableBudgets: Budget[],
): ValidationResult<DateKey> {
  if (!isValidDateKey(date)) {
    return { ok: false, error: "Choose a valid date." };
  }

  if (applicableBudgets.length === 0) {
    return {
      ok: false,
      error: "No budget allotment covers this date.",
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
  /** Budgets whose period covers the chosen date. */
  applicableBudgets: Budget[];
}

/**
 * Validates the whole expense form.
 *
 * An expense must land in exactly one budget: the date has to be covered, and
 * the chosen budget has to be one of the budgets covering it. Nothing is
 * assigned by guesswork.
 */
export function validateExpenseForm(
  name: string,
  amount: string,
  expenseDate: string,
  budgetId: string,
  options: ExpenseFormOptions,
): ExpenseFormResult {
  const { applicableBudgets, ...amountOptions } = options;

  const nameResult = validateExpenseName(name);
  const amountResult = validateExpenseAmount(amount, amountOptions);
  const dateResult = validateExpenseDate(expenseDate, applicableBudgets);

  const errors: ExpenseFormErrors = {};
  if (!nameResult.ok) errors.name = nameResult.error;
  if (!amountResult.ok) errors.amount = amountResult.error;
  if (!dateResult.ok) errors.expenseDate = dateResult.error;

  if (dateResult.ok) {
    if (budgetId.trim() === "") {
      errors.budgetId = "Choose which budget this belongs to.";
    } else if (!applicableBudgets.some((budget) => budget.id === budgetId)) {
      errors.budgetId = "That budget does not cover the selected date.";
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
