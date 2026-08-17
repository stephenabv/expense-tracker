"use client";

/**
 * Owns the single source of truth for budget and expenses.
 *
 * Components read derived totals from `useTracker()` and never compute money
 * themselves. Persistence goes through the injected `TrackerRepository`, so
 * moving to a database means passing a different repository here.
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

import type { Expense, ExpenseInput, TrackerState, TrackerTotals } from "@/types/expense";
import {
  calculateAvailableBalance,
  calculateTotals,
  sortExpensesByNewest,
} from "@/lib/calculations";
import {
  EMPTY_STATE,
  createLocalStorageRepository,
  type TrackerRepository,
} from "@/lib/storage";
import { roundCurrency } from "@/lib/currency";
import { createId } from "@/lib/utils";

interface InternalState extends TrackerState {
  /** False until persisted data has been read, so the UI can avoid a flash. */
  hydrated: boolean;
}

type Action =
  | { type: "hydrate"; payload: TrackerState }
  | { type: "setBudget"; payload: number }
  | { type: "addExpense"; payload: Expense }
  | { type: "updateExpense"; payload: { id: string; input: ExpenseInput } }
  | { type: "deleteExpense"; payload: { id: string } }
  | { type: "reset" };

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case "hydrate":
      return { ...action.payload, hydrated: true };

    case "setBudget":
      return { ...state, budget: roundCurrency(action.payload) };

    case "addExpense":
      return { ...state, expenses: [action.payload, ...state.expenses] };

    case "updateExpense":
      return {
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
      };

    case "deleteExpense":
      return {
        ...state,
        expenses: state.expenses.filter(
          (expense) => expense.id !== action.payload.id,
        ),
      };

    case "reset":
      return { ...EMPTY_STATE, hydrated: true };

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
    ...EMPTY_STATE,
    hydrated: false,
  });

  // Load persisted state once on mount. Reading in an effect (rather than
  // during render) keeps the server and first client render identical.
  useEffect(() => {
    let cancelled = false;

    repo
      .load()
      .then((loaded) => {
        if (!cancelled) dispatch({ type: "hydrate", payload: loaded });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "hydrate", payload: EMPTY_STATE });
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
    void repo.save({ budget: state.budget, expenses: state.expenses });
  }, [repo, state.hydrated, state.budget, state.expenses]);

  const setBudget = useCallback((value: number) => {
    dispatch({ type: "setBudget", payload: value });
  }, []);

  const addExpense = useCallback((input: ExpenseInput) => {
    const expense: Expense = {
      id: createId(),
      name: input.name,
      amount: roundCurrency(input.amount),
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "addExpense", payload: expense });
    return expense;
  }, []);

  const updateExpense = useCallback((id: string, input: ExpenseInput) => {
    dispatch({ type: "updateExpense", payload: { id, input } });
  }, []);

  const deleteExpense = useCallback((id: string) => {
    dispatch({ type: "deleteExpense", payload: { id } });
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
