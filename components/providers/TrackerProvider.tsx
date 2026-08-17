"use client";

/**
 * Owns the single source of truth: budget allotments and expenses.
 *
 * Components read derived figures from `useTracker()` and never compute money
 * themselves. Persistence goes through the injected `TrackerRepository`, so
 * moving to a database means passing a different repository here.
 *
 * Nothing derived is stored. Balances, statuses and History are all computed
 * from budgets + expenses, which is why they can never drift apart.
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

import type { Budget, BudgetInput, BudgetSummary } from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import {
  calculateAvailableBalance,
  sortExpensesByNewest,
} from "@/lib/calculations";
import {
  EMPTY_DATA,
  createLocalStorageRepository,
  type PersistedData,
  type TrackerRepository,
} from "@/lib/storage";
import {
  activeBudget,
  budgetsForDate,
  expensesForBudget,
  isCompleted,
  sortBudgetsByPeriod,
  summarizeBudgets,
} from "@/lib/budgets";
import { todayKey, type DateKey } from "@/lib/dates";
import { roundCurrency } from "@/lib/currency";
import { createId } from "@/lib/utils";

interface InternalState extends PersistedData {
  /** False until persisted data has been read, so the UI can avoid a flash. */
  hydrated: boolean;
}

type Action =
  | { type: "hydrate"; payload: PersistedData }
  | { type: "addBudget"; payload: Budget }
  | { type: "updateBudget"; payload: { id: string; input: BudgetInput; now: string } }
  | { type: "setBudgetLocked"; payload: { id: string; locked: boolean; now: string } }
  | { type: "deleteBudget"; payload: { id: string } }
  | { type: "addExpense"; payload: Expense }
  | { type: "updateExpense"; payload: { id: string; input: ExpenseInput; now: string } }
  | { type: "deleteExpense"; payload: { id: string } }
  | { type: "reset" };

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case "hydrate":
      return { ...action.payload, hydrated: true };

    case "addBudget":
      return { ...state, budgets: [action.payload, ...state.budgets] };

    case "updateBudget":
      return {
        ...state,
        budgets: state.budgets.map((budget) =>
          budget.id === action.payload.id
            ? {
                ...budget,
                name: action.payload.input.name,
                amount: roundCurrency(action.payload.input.amount),
                startDate: action.payload.input.startDate,
                endDate: action.payload.input.endDate,
                updatedAt: action.payload.now,
                // Saving re-locks: editing is always a deliberate, bounded act.
                locked: true,
              }
            : budget,
        ),
      };

    case "setBudgetLocked":
      return {
        ...state,
        budgets: state.budgets.map((budget) =>
          budget.id === action.payload.id
            ? { ...budget, locked: action.payload.locked, updatedAt: action.payload.now }
            : budget,
        ),
      };

    case "deleteBudget":
      return {
        ...state,
        budgets: state.budgets.filter((budget) => budget.id !== action.payload.id),
        // An expense cannot outlive the allotment it was charged to.
        expenses: state.expenses.filter(
          (expense) => expense.budgetId !== action.payload.id,
        ),
      };

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
                expenseDate: action.payload.input.expenseDate,
                budgetId: action.payload.input.budgetId,
                updatedAt: action.payload.now,
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
      return { ...EMPTY_DATA, hydrated: true };

    default:
      return state;
  }
}

interface TrackerContextValue {
  hydrated: boolean;
  /** All allotments, newest period first. */
  budgets: Budget[];
  /** Derived figures for each budget, in the same order. */
  budgetSummaries: BudgetSummary[];
  /** Every expense, newest first. */
  expenses: Expense[];
  /** The allotment covering today, when exactly one does. */
  currentBudget: Budget | null;

  createBudget: (input: BudgetInput) => Budget;
  updateBudget: (id: string, input: BudgetInput) => void;
  setBudgetLocked: (id: string, locked: boolean) => void;
  deleteBudget: (id: string) => void;

  addExpense: (input: ExpenseInput) => Expense;
  updateExpense: (id: string, input: ExpenseInput) => void;
  deleteExpense: (id: string) => void;
  resetAll: () => void;

  /** Lookups that read the latest state without re-rendering their callers. */
  getBudget: (id: string) => Budget | null;
  getBudgetSummary: (id: string) => BudgetSummary | null;
  expensesFor: (budgetId: string) => Expense[];
  budgetsCovering: (date: DateKey) => Budget[];
  /**
   * Balance a budget can still spend. Pass the id of the expense being edited so
   * its current amount is not counted against the user twice.
   */
  availableBalanceFor: (budgetId: string, excludeExpenseId?: string) => number;
  /** True once the period has ended, which makes the budget immutable. */
  isBudgetCompleted: (budget: Budget) => boolean;
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
        if (!cancelled) dispatch({ type: "hydrate", payload: loaded });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "hydrate", payload: EMPTY_DATA });
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
    void repo.save({ budgets: state.budgets, expenses: state.expenses });
  }, [repo, state.hydrated, state.budgets, state.expenses]);

  const createBudget = useCallback((input: BudgetInput) => {
    const timestamp = new Date().toISOString();
    const budget: Budget = {
      id: createId(),
      name: input.name,
      amount: roundCurrency(input.amount),
      startDate: input.startDate,
      endDate: input.endDate,
      createdAt: timestamp,
      updatedAt: timestamp,
      // New budgets arrive locked, so the amount cannot be nudged by accident.
      locked: true,
    };
    dispatch({ type: "addBudget", payload: budget });
    return budget;
  }, []);

  const updateBudget = useCallback((id: string, input: BudgetInput) => {
    dispatch({
      type: "updateBudget",
      payload: { id, input, now: new Date().toISOString() },
    });
  }, []);

  const setBudgetLocked = useCallback((id: string, locked: boolean) => {
    dispatch({
      type: "setBudgetLocked",
      payload: { id, locked, now: new Date().toISOString() },
    });
  }, []);

  const deleteBudget = useCallback((id: string) => {
    dispatch({ type: "deleteBudget", payload: { id } });
  }, []);

  const addExpense = useCallback((input: ExpenseInput) => {
    const timestamp = new Date().toISOString();
    const expense: Expense = {
      id: createId(),
      budgetId: input.budgetId,
      name: input.name,
      amount: roundCurrency(input.amount),
      expenseDate: input.expenseDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    dispatch({ type: "addExpense", payload: expense });
    return expense;
  }, []);

  const updateExpense = useCallback((id: string, input: ExpenseInput) => {
    dispatch({
      type: "updateExpense",
      payload: { id, input, now: new Date().toISOString() },
    });
  }, []);

  const deleteExpense = useCallback((id: string) => {
    dispatch({ type: "deleteExpense", payload: { id } });
  }, []);

  const resetAll = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  const sortedBudgets = useMemo(
    () => sortBudgetsByPeriod(state.budgets),
    [state.budgets],
  );

  const sortedExpenses = useMemo(
    () => sortExpensesByNewest(state.expenses),
    [state.expenses],
  );

  const budgetSummaries = useMemo(
    () => summarizeBudgets(sortedBudgets, state.expenses),
    [sortedBudgets, state.expenses],
  );

  const currentBudget = useMemo(
    () => activeBudget(sortedBudgets),
    [sortedBudgets],
  );

  const getBudget = useCallback(
    (id: string) => stateRef.current.budgets.find((b) => b.id === id) ?? null,
    [],
  );

  const getBudgetSummary = useCallback(
    (id: string) => budgetSummaries.find((entry) => entry.budget.id === id) ?? null,
    [budgetSummaries],
  );

  const expensesFor = useCallback(
    (budgetId: string) =>
      sortExpensesByNewest(expensesForBudget(stateRef.current.expenses, budgetId)),
    [],
  );

  const budgetsCovering = useCallback(
    (date: DateKey) => budgetsForDate(stateRef.current.budgets, date),
    [],
  );

  const availableBalanceFor = useCallback(
    (budgetId: string, excludeExpenseId?: string) => {
      const budget = stateRef.current.budgets.find((b) => b.id === budgetId);
      if (!budget) return 0;

      return calculateAvailableBalance(
        budget.amount,
        expensesForBudget(stateRef.current.expenses, budgetId),
        excludeExpenseId,
      );
    },
    [],
  );

  const isBudgetCompleted = useCallback((budget: Budget) => isCompleted(budget), []);

  const value = useMemo<TrackerContextValue>(
    () => ({
      hydrated: state.hydrated,
      budgets: sortedBudgets,
      budgetSummaries,
      expenses: sortedExpenses,
      currentBudget,
      createBudget,
      updateBudget,
      setBudgetLocked,
      deleteBudget,
      addExpense,
      updateExpense,
      deleteExpense,
      resetAll,
      getBudget,
      getBudgetSummary,
      expensesFor,
      budgetsCovering,
      availableBalanceFor,
      isBudgetCompleted,
    }),
    [
      state.hydrated,
      sortedBudgets,
      budgetSummaries,
      sortedExpenses,
      currentBudget,
      createBudget,
      updateBudget,
      setBudgetLocked,
      deleteBudget,
      addExpense,
      updateExpense,
      deleteExpense,
      resetAll,
      getBudget,
      getBudgetSummary,
      expensesFor,
      budgetsCovering,
      availableBalanceFor,
      isBudgetCompleted,
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

/** Today's date key — handy default for date inputs. */
export function useToday(): DateKey {
  return useMemo(() => todayKey(), []);
}
