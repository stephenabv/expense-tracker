/**
 * Persistence layer.
 *
 * The app talks to the `TrackerRepository` interface only, never to
 * `localStorage` directly. Swapping in a database-backed REST client later means
 * writing one new implementation of this interface — the UI and the state
 * provider stay untouched, which is why every method is async.
 */

import type { TrackerState } from "@/types/expense";
import { MAX_AMOUNT, roundCurrency } from "@/lib/currency";
import { MAX_NAME_LENGTH } from "@/lib/validation";

export const STORAGE_KEY = "expense-tracker:v1";
export const STORAGE_VERSION = 1;

export const EMPTY_STATE: TrackerState = { budget: null, expenses: [] };

export interface TrackerRepository {
  load(): Promise<TrackerState>;
  save(state: TrackerState): Promise<void>;
  clear(): Promise<void>;
}

interface PersistedShape {
  version: number;
  budget: number | null;
  expenses: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeBudget(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  if (numeric < 0) return null;
  return roundCurrency(Math.min(numeric, MAX_AMOUNT));
}

function sanitizeExpense(value: unknown, index: number) {
  if (!isRecord(value)) return null;

  const amountRaw =
    typeof value.amount === "string" ? Number(value.amount) : value.amount;
  if (typeof amountRaw !== "number" || !Number.isFinite(amountRaw)) return null;

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

/**
 * Turns whatever was in storage into valid state.
 *
 * Malformed JSON, a wrong shape, or individual bad records are dropped rather
 * than thrown — a corrupted entry must never take down the whole dashboard.
 * Exported separately from the repository so the recovery rules are unit
 * testable without a browser.
 */
export function parseStoredState(raw: string | null): TrackerState {
  if (!raw) return EMPTY_STATE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }

  if (!isRecord(parsed)) return EMPTY_STATE;

  const expensesRaw = Array.isArray(parsed.expenses) ? parsed.expenses : [];
  const expenses = expensesRaw
    .map((expense, index) => sanitizeExpense(expense, index))
    .filter((expense): expense is NonNullable<typeof expense> => expense !== null);

  // Guard against duplicate ids from hand-edited or merged storage.
  const seen = new Set<string>();
  const uniqueExpenses = expenses.filter((expense) => {
    if (seen.has(expense.id)) return false;
    seen.add(expense.id);
    return true;
  });

  return {
    budget: sanitizeBudget(parsed.budget),
    expenses: uniqueExpenses,
  };
}

export function serializeState(state: TrackerState): string {
  const payload: PersistedShape = {
    version: STORAGE_VERSION,
    budget: state.budget,
    expenses: state.expenses,
  };
  return JSON.stringify(payload);
}

/** Browser-backed repository. Degrades to in-memory when storage is unavailable. */
export function createLocalStorageRepository(
  key: string = STORAGE_KEY,
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
      if (!isAvailable()) return EMPTY_STATE;
      try {
        return parseStoredState(window.localStorage.getItem(key));
      } catch {
        return EMPTY_STATE;
      }
    },

    async save(state) {
      if (!isAvailable()) return;
      try {
        window.localStorage.setItem(key, serializeState(state));
      } catch {
        // Quota exceeded or storage disabled — the in-memory state stays correct.
      }
    },

    async clear() {
      if (!isAvailable()) return;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing further to do.
      }
    },
  };
}
