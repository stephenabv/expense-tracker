/**
 * Persistence layer.
 *
 * The app talks to the `TrackerRepository` interface only, never to
 * `localStorage` directly. Swapping in a database-backed REST client later means
 * writing one new implementation of this interface — the UI and the state
 * provider stay untouched, which is why every method is async.
 *
 * Only source data is stored: budgets and expenses. Balances, statuses and the
 * whole of History are derived from these on demand.
 */

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { MAX_AMOUNT, roundCurrency } from "@/lib/currency";
import { MAX_BUDGET_NAME_LENGTH, MAX_NAME_LENGTH } from "@/lib/validation";
import { isValidDateKey, toDateKey, todayKey, type DateKey } from "@/lib/dates";
import { sortBudgetsByPeriod } from "@/lib/budgets";
import { sortExpensesByNewest } from "@/lib/calculations";
import { createId } from "@/lib/utils";

export const STORAGE_KEY = "expense-tracker:v3";
/** Earlier single-budget formats, read once for migration. */
export const LEGACY_STORAGE_KEYS = ["expense-tracker:v2", "expense-tracker:v1"];
export const STORAGE_VERSION = 3;

/** Name given to the budget created when migrating a single-budget tracker. */
export const MIGRATED_BUDGET_NAME = "Original Budget";

export interface PersistedData {
  budgets: Budget[];
  expenses: Expense[];
}

export const EMPTY_DATA: PersistedData = { budgets: [], expenses: [] };

export interface TrackerRepository {
  load(): Promise<PersistedData>;
  save(data: PersistedData): Promise<void>;
  clear(): Promise<void>;
}

interface PersistedShape {
  version: number;
  budgets: Budget[];
  expenses: Expense[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  return numeric;
}

function sanitizeText(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, max)
    : fallback;
}

function sanitizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;
}

function sanitizeBudget(value: unknown, index: number): Budget | null {
  if (!isRecord(value)) return null;

  const amountRaw = toFiniteNumber(value.amount);
  if (amountRaw === null || amountRaw < 0) return null;

  // A budget without a usable period cannot decide which expenses it covers.
  if (!isValidDateKey(value.startDate) || !isValidDateKey(value.endDate)) {
    return null;
  }

  const startDate = value.startDate as DateKey;
  const endDate = value.endDate as DateKey;
  // Repair a reversed period rather than discarding the record.
  const [start, end] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];

  const createdAt = sanitizeTimestamp(value.createdAt, new Date(0).toISOString());

  return {
    id:
      typeof value.id === "string" && value.id.trim() !== ""
        ? value.id
        : `recovered-budget-${index}-${Date.now()}`,
    name: sanitizeText(value.name, MAX_BUDGET_NAME_LENGTH, "Untitled budget"),
    amount: roundCurrency(Math.min(amountRaw, MAX_AMOUNT)),
    startDate: start,
    endDate: end,
    createdAt,
    updatedAt: sanitizeTimestamp(value.updatedAt, createdAt),
    locked: value.locked !== false,
  };
}

function sanitizeExpense(value: unknown, index: number): Expense | null {
  if (!isRecord(value)) return null;

  const amountRaw = toFiniteNumber(value.amount);
  if (amountRaw === null) return null;

  const amount = roundCurrency(Math.min(Math.abs(amountRaw), MAX_AMOUNT));
  if (amount <= 0) return null;

  if (typeof value.budgetId !== "string" || value.budgetId.trim() === "") {
    return null;
  }

  const createdAt = sanitizeTimestamp(value.createdAt, new Date(0).toISOString());

  // Fall back to the recording time when the calendar day is missing.
  const expenseDate = isValidDateKey(value.expenseDate)
    ? (value.expenseDate as DateKey)
    : toDateKey(createdAt);
  if (!isValidDateKey(expenseDate)) return null;

  return {
    id:
      typeof value.id === "string" && value.id.trim() !== ""
        ? value.id
        : `recovered-${index}-${Date.now()}`,
    budgetId: value.budgetId,
    name: sanitizeText(value.name, MAX_NAME_LENGTH, "Untitled expense"),
    amount,
    expenseDate,
    createdAt,
    updatedAt: sanitizeTimestamp(value.updatedAt, createdAt),
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Turns whatever was in storage into valid data.
 *
 * Malformed JSON, a wrong shape, or individual bad records are dropped rather
 * than thrown — a corrupted entry must never take down the whole app. Expenses
 * pointing at a budget that no longer exists are dropped too, since an expense
 * with no allotment has no balance to belong to.
 */
export function parseStoredData(raw: string | null): PersistedData {
  if (!raw) return { ...EMPTY_DATA };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_DATA };
  }

  if (!isRecord(parsed)) return { ...EMPTY_DATA };

  const budgets = dedupeById(
    (Array.isArray(parsed.budgets) ? parsed.budgets : [])
      .map(sanitizeBudget)
      .filter((budget): budget is Budget => budget !== null),
  );

  const budgetIds = new Set(budgets.map((budget) => budget.id));

  const expenses = dedupeById(
    (Array.isArray(parsed.expenses) ? parsed.expenses : [])
      .map(sanitizeExpense)
      .filter((expense): expense is Expense => expense !== null)
      .filter((expense) => budgetIds.has(expense.budgetId)),
  );

  return {
    budgets: sortBudgetsByPeriod(budgets),
    expenses: sortExpensesByNewest(expenses),
  };
}

export function serializeData(data: PersistedData): string {
  const payload: PersistedShape = {
    version: STORAGE_VERSION,
    budgets: data.budgets,
    expenses: data.expenses,
  };
  return JSON.stringify(payload);
}

/**
 * Upgrades a single-budget payload (v1 or v2).
 *
 * Those versions had one global budget and no notion of a period, so the whole
 * tracker becomes one allotment spanning the days it actually covers. The name
 * is fixed rather than invented per-user, and the user can rename it like any
 * other budget.
 */
export function migrateLegacyData(
  raw: string | null,
  now: Date = new Date(),
): PersistedData | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (Array.isArray(parsed.budgets)) return null; // Already a v3 payload.

  const amount = toFiniteNumber(parsed.budget);
  const legacyExpenses = (Array.isArray(parsed.expenses) ? parsed.expenses : [])
    .map((value, index) => {
      if (!isRecord(value)) return null;

      const expenseAmount = toFiniteNumber(value.amount);
      if (expenseAmount === null) return null;

      const rounded = roundCurrency(Math.min(Math.abs(expenseAmount), MAX_AMOUNT));
      if (rounded <= 0) return null;

      const createdAt = sanitizeTimestamp(value.createdAt, now.toISOString());
      const expenseDate = toDateKey(createdAt);
      if (!isValidDateKey(expenseDate)) return null;

      return {
        id:
          typeof value.id === "string" && value.id.trim() !== ""
            ? value.id
            : `migrated-${index}-${Date.now()}`,
        name: sanitizeText(value.name, MAX_NAME_LENGTH, "Untitled expense"),
        amount: rounded,
        expenseDate,
        createdAt,
      };
    })
    .filter((expense): expense is NonNullable<typeof expense> => expense !== null);

  if (amount === null && legacyExpenses.length === 0) return null;

  const today = todayKey(now);
  const dates = legacyExpenses.map((expense) => expense.expenseDate).sort();

  // Span every day the old tracker touched, and stay open through today so the
  // migrated budget is still usable rather than instantly "completed".
  const startDate = dates.length > 0 && dates[0] < today ? dates[0] : today;
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : today;
  const endDate = lastDate > today ? lastDate : today;

  const timestamp = now.toISOString();
  const budget: Budget = {
    id: createId(),
    name: MIGRATED_BUDGET_NAME,
    amount: roundCurrency(Math.min(Math.max(amount ?? 0, 0), MAX_AMOUNT)),
    startDate,
    endDate,
    createdAt: timestamp,
    updatedAt: timestamp,
    locked: true,
  };

  return {
    budgets: [budget],
    expenses: sortExpensesByNewest(
      legacyExpenses.map((expense) => ({
        ...expense,
        budgetId: budget.id,
        updatedAt: expense.createdAt,
      })),
    ),
  };
}

/** Browser-backed repository. Degrades to in-memory when storage is unavailable. */
export function createLocalStorageRepository(
  key: string = STORAGE_KEY,
  legacyKeys: string[] = LEGACY_STORAGE_KEYS,
): TrackerRepository {
  const isAvailable = () => {
    try {
      return typeof window !== "undefined" && window.localStorage !== null;
    } catch {
      // Blocked by browser privacy settings.
      return false;
    }
  };

  return {
    async load() {
      if (!isAvailable()) return { ...EMPTY_DATA };

      try {
        const current = window.localStorage.getItem(key);
        if (current !== null) return parseStoredData(current);

        // First run after multi-budget shipped: carry the old tracker forward.
        for (const legacyKey of legacyKeys) {
          const migrated = migrateLegacyData(window.localStorage.getItem(legacyKey));
          if (migrated) {
            window.localStorage.setItem(key, serializeData(migrated));
            return migrated;
          }
        }

        return { ...EMPTY_DATA };
      } catch {
        return { ...EMPTY_DATA };
      }
    },

    async save(data) {
      if (!isAvailable()) return;
      try {
        window.localStorage.setItem(key, serializeData(data));
      } catch {
        // Quota exceeded or storage disabled — in-memory state stays correct.
      }
    },

    async clear() {
      if (!isAvailable()) return;
      try {
        window.localStorage.removeItem(key);
        for (const legacyKey of legacyKeys) {
          window.localStorage.removeItem(legacyKey);
        }
      } catch {
        // Nothing further to do.
      }
    },
  };
}
