/**
 * Input validation for budgets and expenses.
 *
 * Validation is pure and framework-free so the same rules can be reused by a
 * future server/API layer without touching the UI.
 */

import { MAX_AMOUNT, formatCurrency, parseAmount } from "@/lib/currency";

export const MAX_NAME_LENGTH = 60;

/**
 * Overdraft policy.
 *
 * The initial product blocks any expense that would push the balance below
 * zero. The check is expressed as an option rather than a hardcoded rule so
 * overdraft support can later be enabled per-call (or per-user) without
 * reworking the validators or the forms that consume them.
 */
export const ALLOW_OVERDRAFT_BY_DEFAULT = false;

export interface ValidationResult<T> {
  ok: boolean;
  /** Present only when `ok` is true. */
  value?: T;
  /** Human-readable message shown beneath the offending field. */
  error?: string;
}

export interface ExpenseAmountOptions {
  /** Balance the expense is charged against. Omit to skip the overdraft check. */
  availableBalance?: number;
  /** When true, an expense may exceed the available balance. */
  allowOverdraft?: boolean;
}

/** Validates a raw budget string from the budget form. */
export function validateBudget(input: string): ValidationResult<number> {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter a budget amount." };
  }

  const value = parseAmount(trimmed);
  if (value === null) {
    return { ok: false, error: "Enter a valid number, e.g. 13000." };
  }

  if (value < 0) {
    return { ok: false, error: "Budget cannot be negative." };
  }

  if (value > MAX_AMOUNT) {
    return {
      ok: false,
      error: `Budget cannot exceed ${formatCurrency(MAX_AMOUNT)}.`,
    };
  }

  return { ok: true, value };
}

/** Validates a raw expense name. */
export function validateExpenseName(input: string): ValidationResult<string> {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Give this expense a name." };
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Keep the name under ${MAX_NAME_LENGTH} characters.`,
    };
  }

  return { ok: true, value: trimmed };
}

/** Validates a raw expense amount, including the overdraft rule. */
export function validateExpenseAmount(
  input: string,
  options: ExpenseAmountOptions = {},
): ValidationResult<number> {
  const {
    availableBalance,
    allowOverdraft = ALLOW_OVERDRAFT_BY_DEFAULT,
  } = options;

  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter an amount." };
  }

  const value = parseAmount(trimmed);
  if (value === null) {
    return { ok: false, error: "Enter a valid number, e.g. 500." };
  }

  if (value <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  if (value > MAX_AMOUNT) {
    return {
      ok: false,
      error: `Amount cannot exceed ${formatCurrency(MAX_AMOUNT)}.`,
    };
  }

  if (
    !allowOverdraft &&
    typeof availableBalance === "number" &&
    Number.isFinite(availableBalance) &&
    value > availableBalance
  ) {
    return {
      ok: false,
      error: `That exceeds your available balance of ${formatCurrency(
        Math.max(availableBalance, 0),
      )}.`,
    };
  }

  return { ok: true, value };
}

export interface ExpenseFormErrors {
  name?: string;
  amount?: string;
}

export interface ExpenseFormResult {
  ok: boolean;
  values?: { name: string; amount: number };
  errors: ExpenseFormErrors;
}

/** Validates both expense fields at once so the form can show every error. */
export function validateExpenseForm(
  name: string,
  amount: string,
  options: ExpenseAmountOptions = {},
): ExpenseFormResult {
  const nameResult = validateExpenseName(name);
  const amountResult = validateExpenseAmount(amount, options);

  const errors: ExpenseFormErrors = {};
  if (!nameResult.ok) errors.name = nameResult.error;
  if (!amountResult.ok) errors.amount = amountResult.error;

  if (!nameResult.ok || !amountResult.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: { name: nameResult.value!, amount: amountResult.value! },
    errors,
  };
}
