/**
 * Persistence layer.
 *
 * The app talks to the `TrackerRepository` interface only, never to
 * `localStorage` directly. Swapping in a database-backed REST client later means
 * writing one new implementation of this interface — the UI and the state
 * provider stay untouched, which is why every method is async.
 *
 * Storage holds the live tracker *and* the sealed daily history. Both are
 * source data: history is not derived from the current tracker, because the
 * current tracker changes and history must not.
 */

import type { Expense, TrackerState } from "@/types/expense";
import type { HistoryDay } from "@/types/history";
import { MAX_AMOUNT, roundCurrency } from "@/lib/currency";
import { MAX_NAME_LENGTH } from "@/lib/validation";
import { backfillHistory, isValidDateKey, sortHistory } from "@/lib/history";
import { calculateTotalExpenses, sortExpensesByNewest } from "@/lib/calculations";

export const STORAGE_KEY = "expense-tracker:v2";
export const LEGACY_STORAGE_KEY = "expense-tracker:v1";
export const STORAGE_VERSION = 2;

/** Everything the app persists. */
export interface PersistedData extends TrackerState {
  history: HistoryDay[];
}

export const EMPTY_STATE: TrackerState = { budget: null, expenses: [] };
export const EMPTY_DATA: PersistedData = { budget: null, expenses: [], history: [] };

export interface TrackerRepository {
  load(): Promise<PersistedData>;
  save(data: PersistedData): Promise<void>;
  clear(): Promise<void>;
}

interface PersistedShape {
  version: number;
  budget: number | null;
  expenses: Expense[];
  history: HistoryDay[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  return numeric;
}

function sanitizeBudget(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric < 0) return null;
  return roundCurrency(Math.min(numeric, MAX_AMOUNT));
}

function sanitizeExpense(value: unknown, index: number): Expense | null {
  if (!isRecord(value)) return null;

  const amountRaw = toFiniteNumber(value.amount);
  if (amountRaw === null) return null;

  const amount = roundCurrency(Math.min(Math.abs(amountRaw), MAX_AMOUNT));
  if (amount <= 0) return null;

  const name =
    typeof value.name === "string" && value.name.trim() !== ""
      ? value.name.trim().slice(0, MAX_NAME_LENGTH)
      : "Untitled expense";

  const id =
    typeof value.id === "string" && value.id.trim() !== ""
      ? value.id
      : `recovered-${index}-${Date.now()}`;

  const createdAtRaw = value.createdAt;
  const createdAt =
    typeof createdAtRaw === "string" && !Number.isNaN(Date.parse(createdAtRaw))
      ? createdAtRaw
      : new Date(0).toISOString();

  return { id, name, amount, createdAt };
}

function sanitizeExpenseList(value: unknown): Expense[] {
  const list = Array.isArray(value) ? value : [];
  const expenses = list
    .map((expense, index) => sanitizeExpense(expense, index))
    .filter((expense): expense is Expense => expense !== null);

  // Guard against duplicate ids from hand-edited or merged storage.
  const seen = new Set<string>();
  return expenses.filter((expense) => {
    if (seen.has(expense.id)) return false;
    seen.add(expense.id);
    return true;
  });
}

/**
 * Repairs one stored history record.
 *
 * Recorded budgets and balances are trusted as written — that is the point of a
 * snapshot — but a missing or non-numeric figure is rebuilt from the record's
 * own expenses so a damaged entry still reports something coherent.
 */
function sanitizeHistoryDay(value: unknown): HistoryDay | null {
  if (!isRecord(value)) return null;
  if (!isValidDateKey(value.date)) return null;

  const expenses = sortExpensesByNewest(sanitizeExpenseList(value.expenses));
  const derivedTotal = calculateTotalExpenses(expenses);

  const totalExpenses = toFiniteNumber(value.totalExpenses);
  const total = roundCurrency(
    totalExpenses === null || totalExpenses < 0 ? derivedTotal : totalExpenses,
  );

  const budget = toFiniteNumber(value.budget);
  const endingBalance = toFiniteNumber(value.endingBalance);
  const startingBalance = toFiniteNumber(value.startingBalance);

  const safeBudget = roundCurrency(budget === null ? total : budget);
  const safeEnding = roundCurrency(
    endingBalance === null ? safeBudget - total : endingBalance,
  );
  const safeStarting = roundCurrency(
    startingBalance === null ? safeEnding + total : startingBalance,
  );

  return {
    date: value.date,
    budget: safeBudget,
    startingBalance: safeStarting,
    endingBalance: safeEnding,
    totalExpenses: total,
    expenses,
  };
}

function sanitizeHistory(value: unknown): HistoryDay[] {
  const list = Array.isArray(value) ? value : [];
  const days = list
    .map(sanitizeHistoryDay)
    .filter((day): day is HistoryDay => day !== null);

  // One record per day wins — the last one written for a date.
  const byDate = new Map<string, HistoryDay>();
  for (const day of days) byDate.set(day.date, day);

  return sortHistory([...byDate.values()]);
}

/**
 * Turns whatever was in storage into valid data.
 *
 * Malformed JSON, a wrong shape, or individual bad records are dropped rather
 * than thrown — a corrupted entry must never take down the whole app. Exported
 * separately from the repository so the recovery rules are unit testable
 * without a browser.
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

  return {
    budget: sanitizeBudget(parsed.budget),
    expenses: sanitizeExpenseList(parsed.expenses),
    history: sanitizeHistory(parsed.history),
  };
}

export function serializeData(data: PersistedData): string {
  const payload: PersistedShape = {
    version: STORAGE_VERSION,
    budget: data.budget,
    expenses: data.expenses,
    history: data.history,
  };
  return JSON.stringify(payload);
}

/**
 * Upgrades a v1 payload (tracker only, no history).
 *
 * History is reconstructed from the expenses that exist, using the only budget
 * on record. Those days seal on the next load, so this approximation happens
 * once and never drifts afterwards.
 */
export function migrateLegacyData(
  raw: string | null,
  now: Date = new Date(),
): PersistedData | null {
  if (!raw) return null;

  const legacy = parseStoredData(raw);
  if (legacy.budget === null && legacy.expenses.length === 0) return null;

  return {
    budget: legacy.budget,
    expenses: legacy.expenses,
    history: backfillHistory(legacy, now),
  };
}

/** Browser-backed repository. Degrades to in-memory when storage is unavailable. */
export function createLocalStorageRepository(
  key: string = STORAGE_KEY,
  legacyKey: string = LEGACY_STORAGE_KEY,
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

        // First run after the history feature shipped: carry v1 data forward.
        const migrated = migrateLegacyData(
          window.localStorage.getItem(legacyKey),
        );
        if (migrated) {
          window.localStorage.setItem(key, serializeData(migrated));
          return migrated;
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
        window.localStorage.removeItem(legacyKey);
      } catch {
        // Nothing further to do.
      }
    },
  };
}
