/**
 * Philippine Peso formatting and money-safe arithmetic helpers.
 *
 * All amounts are handled in the major unit (pesos) but rounded through integer
 * centavos so repeated addition never accumulates floating-point drift.
 */

export const CURRENCY_CODE = "PHP";
export const CURRENCY_SYMBOL = "₱";
export const LOCALE = "en-PH";

/**
 * Largest amount the app accepts for a budget or a single expense.
 * Keeps values inside a range that formats cleanly and stays exact in cents.
 */
export const MAX_AMOUNT = 999_999_999_999.99;

const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY_CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimalFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Rounds to the nearest centavo, avoiding binary float artifacts. */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Formats an amount as Philippine Peso, e.g. `₱13,000.00`. */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return currencyFormatter.format(0);
  return currencyFormatter.format(roundCurrency(value));
}

/**
 * Formats an amount without the currency symbol, e.g. `13,000.00`.
 * Used where the symbol is rendered separately (such as an input prefix).
 */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return decimalFormatter.format(0);
  return decimalFormatter.format(roundCurrency(value));
}

/**
 * Parses user input into a number.
 *
 * Tolerates the peso sign, thousands separators and surrounding whitespace, so
 * pasting `₱1,234.50` works. Returns `null` when the text is not a valid number.
 */
export function parseAmount(input: string): number | null {
  if (typeof input !== "string") return null;

  const cleaned = input.replace(/[₱\s,_]/g, "").trim();
  if (cleaned === "") return null;

  // Reject anything that is not a plain decimal number (blocks "1e9", "0x10").
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "." || cleaned === "-") {
    return null;
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  return roundCurrency(value);
}
