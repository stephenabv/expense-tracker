"use client";

/**
 * Owns the single source of truth for budget, expenses and sealed history.
 *
 * Components read derived totals from `useTracker()` and never compute money
 * themselves. Persistence goes through the injected `TrackerRepository`, so
 * moving to a database means passing a different repository here.
 *
 * Every mutating action carries the clock (`now`) so the reducer stays pure
 * while still being able to seal history by calendar day.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import type { Expense, ExpenseInput, TrackerTotals } from "@/types/expense";
import type { HistoryDay } from "@/types/history";
import {
  calculateAvailableBalance,
  calculateTotals,
  sortExpensesByNewest,
} from "@/lib/calculations";
import {
  EMPTY_DATA,
  createLocalStorageRepository,
  type PersistedData,
  type TrackerRepository,
} from "@/lib/storage";
import { syncHistory } from "@/lib/history";
import { roundCurrency } from "@/lib/currency";
import { createId } from "@/lib/utils";

interface InternalState extends PersistedData {
  /** False until persisted data has been read, so the UI can avoid a flash. */
  hydrated: boolean;
}

type Action =
  | { type: "hydrate"; payload: PersistedData; now: Date }
  | { type: "setBudget"; payload: number; now: Date }
  | { type: "addExpense"; payload: Expense; now: Date }
  | { type: "updateExpense"; payload: { id: string; input: ExpenseInput }; now: Date }
  | { type: "deleteExpense"; payload: { id: string }; now: Date }
  | { type: "reset" };

/**
 * Re-seals history around a new tracker state.
 *
 * Only today's record can change; `syncHistory` passes every earlier day
 * through untouched, which is what keeps past reports stable when the budget or
 * an old expense is edited.
 */
function withHistory(state: InternalState, now: Date): InternalState {
  return {
    ...state,
    history: syncHistory(state.history, state, now),
  };
}

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case "hydrate":
      return withHistory({ ...action.payload, hydrated: true }, action.now);

    case "setBudget":
      return withHistory(
        { ...state, budget: roundCurrency(action.payload) },
        action.now,
      );

    case "addExpense":
      return withHistory(
        { ...state, expenses: [action.payload, ...state.expenses] },
        action.now,
      );

    case "updateExpense":
      return withHistory(
        {
          ...state,
          expenses: state.expenses.map((expense) =>
            expense.id === action.payload.id
              ? {
                  ...expense,
                  name: action.payload.input.name,
                  amount: roundCurrency(action.payload.input.amount),
                }
              : expense,
          ),
        },
        action.now,
      );

    case "deleteExpense":
      return withHistory(
        {
          ...state,
          expenses: state.expenses.filter(
            (expense) => expense.id !== action.payload.id,
          ),
        },
        action.now,
      );

    case "reset":
      return { ...EMPTY_DATA, hydrated: true };

    default:
      return state;
  }
}

interface TrackerContextValue {
  /** True once persisted state has loaded. */
  hydrated: boolean;
  /** `null` when the user has not configured a budget yet. */
  budget: number | null;
  /** Always sorted newest first. */
  expenses: Expense[];
  totals: TrackerTotals;
  /**
   * Sealed daily records, oldest first.
   *
   * Past days are immutable snapshots — they keep the budget and balances that
   * were in effect at the time, so they stay accurate after the budget changes.
   */
  history: HistoryDay[];
  setBudget: (value: number) => void;
  addExpense: (input: ExpenseInput) => Expense;
  updateExpense: (id: string, input: ExpenseInput) => void;
  deleteExpense: (id: string) => void;
  resetAll: () => void;
  /**
   * Balance an expense can draw from. Pass the id of the expense being edited
   * so its current amount is not counted against the user twice.
   */
  availableBalanceFor: (excludeExpenseId?: string) => number;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

export function TrackerProvider({
  children,
  repository,
}: {
  children: ReactNode;
  repository?: TrackerRepository;
}) {
  const repo = useMemo(
    () => repository ?? createLocalStorageRepository(),
    [repository],
  );

  const [state, dispatch] = useReducer(reducer, {
    ...EMPTY_DATA,
    hydrated: false,
  });

  // Load persisted state once on mount. Reading in an effect (rather than
  // during render) keeps the server and first client render identical.
  useEffect(() => {
    let cancelled = false;

    repo
      .load()
      .then((loaded) => {
        if (!cancelled)
          dispatch({ type: "hydrate", payload: loaded, now: new Date() });
      })
      .catch(() => {
        if (!cancelled)
          dispatch({ type: "hydrate", payload: EMPTY_DATA, now: new Date() });
      });

    return () => {
      cancelled = true;
    };
  }, [repo]);

  // Persist after every change, but never write the pre-hydration placeholder
  // over real saved data.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!state.hydrated) return;
    void repo.save({
      budget: state.budget,
      expenses: state.expenses,
      history: state.history,
    });
  }, [repo, state.hydrated, state.budget, state.expenses, state.history]);

  const setBudget = useCallback((value: number) => {
    dispatch({ type: "setBudget", payload: value, now: new Date() });
  }, []);

  const addExpense = useCallback((input: ExpenseInput) => {
    const expense: Expense = {
      id: createId(),
      name: input.name,
      amount: roundCurrency(input.amount),
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "addExpense", payload: expense, now: new Date() });
    return expense;
  }, []);

  const updateExpense = useCallback((id: string, input: ExpenseInput) => {
    dispatch({ type: "updateExpense", payload: { id, input }, now: new Date() });
  }, []);

  const deleteExpense = useCallback((id: string) => {
    dispatch({ type: "deleteExpense", payload: { id }, now: new Date() });
  }, []);

  const resetAll = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  const availableBalanceFor = useCallback(
    (excludeExpenseId?: string) =>
      calculateAvailableBalance(
        { budget: stateRef.current.budget, expenses: stateRef.current.expenses },
        excludeExpenseId,
      ),
    [],
  );

  const sortedExpenses = useMemo(
    () => sortExpensesByNewest(state.expenses),
    [state.expenses],
  );

  const totals = useMemo(
    () => calculateTotals({ budget: state.budget, expenses: state.expenses }),
    [state.budget, state.expenses],
  );

  const value = useMemo<TrackerContextValue>(
    () => ({
      hydrated: state.hydrated,
      budget: state.budget,
      expenses: sortedExpenses,
      totals,
      history: state.history,
      setBudget,
      addExpense,
      updateExpense,
      deleteExpense,
      resetAll,
      availableBalanceFor,
    }),
    [
      state.hydrated,
      state.budget,
      sortedExpenses,
      totals,
      state.history,
      setBudget,
      addExpense,
      updateExpense,
      deleteExpense,
      resetAll,
      availableBalanceFor,
    ],
  );

  return (
    <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
  );
}

export function useTracker(): TrackerContextValue {
  const context = useContext(TrackerContext);
  if (!context) {
    throw new Error("useTracker must be used within a TrackerProvider");
  }
  return context;
}
