"use client";

/**
 * Client-side view of one user's tracker.
 *
 * The server is authoritative. Every mutation calls a server action, which
 * re-validates the request and resolves the owner from the session cookie, then
 * this provider applies the row the server returned. Nothing is written locally
 * and hoped for: if the server refuses, local state never changes and the
 * reason is surfaced.
 *
 * Derived figures (balances, statuses, history) are still computed here from
 * the same pure functions the server uses, so the two cannot disagree.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Budget, BudgetInput, BudgetSummary } from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import { calculateAvailableBalance, sortExpensesByNewest } from "@/lib/calculations";
import {
  activeBudget,
  budgetsForDate,
  expensesForBudget,
  isCompleted,
  sortBudgetsByPeriod,
  summarizeBudgets,
} from "@/lib/budgets";
import { todayKey, type DateKey } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
import {
  createBudgetAction,
  createExpenseAction,
  deleteBudgetAction,
  deleteExpenseAction,
  setBudgetLockedAction,
  updateBudgetAction,
  updateExpenseAction,
} from "@/lib/server/tracker-actions";

interface TrackerContextValue {
  /** Server-rendered data arrives with the page, so this is always true. */
  hydrated: boolean;
  /** True while a mutation is in flight. */
  pending: boolean;
  budgets: Budget[];
  budgetSummaries: BudgetSummary[];
  expenses: Expense[];
  currentBudget: Budget | null;

  createBudget: (input: BudgetInput) => Promise<void>;
  updateBudget: (id: string, input: BudgetInput) => Promise<void>;
  setBudgetLocked: (id: string, locked: boolean) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;

  addExpense: (input: ExpenseInput) => Promise<void>;
  updateExpense: (id: string, input: ExpenseInput) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;

  getBudget: (id: string) => Budget | null;
  getBudgetSummary: (id: string) => BudgetSummary | null;
  expensesFor: (budgetId: string) => Expense[];
  budgetsCovering: (date: DateKey) => Budget[];
  availableBalanceFor: (budgetId: string, excludeExpenseId?: string) => number;
  isBudgetCompleted: (budget: Budget) => boolean;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

export function TrackerProvider({
  children,
  initialBudgets,
  initialExpenses,
}: {
  children: ReactNode;
  initialBudgets: Budget[];
  initialExpenses: Expense[];
}) {
  const { showToast } = useToast();
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [inFlight, setInFlight] = useState(0);
  const inFlightRef = useRef(0);

  /** Wraps a mutation so the UI can show that something is being saved. */
  const track = useCallback(async (run: () => Promise<void>) => {
    inFlightRef.current += 1;
    setInFlight(inFlightRef.current);
    try {
      await run();
    } finally {
      inFlightRef.current -= 1;
      setInFlight(inFlightRef.current);
    }
  }, []);

  /** Reports a refusal without changing local state. */
  const fail = useCallback(
    (message: string) => {
      showToast(message);
    },
    [showToast],
  );

  const createBudget = useCallback(
    (input: BudgetInput) =>
      track(async () => {
        const result = await createBudgetAction(input);
        if (!result.ok) return fail(result.error);
        setBudgets((current) => [result.data, ...current]);
      }),
    [fail, track],
  );

  const updateBudget = useCallback(
    (id: string, input: BudgetInput) =>
      track(async () => {
        const result = await updateBudgetAction(id, input);
        if (!result.ok) return fail(result.error);
        setBudgets((current) =>
          current.map((budget) => (budget.id === id ? result.data : budget)),
        );
      }),
    [fail, track],
  );

  const setBudgetLocked = useCallback(
    (id: string, locked: boolean) =>
      track(async () => {
        const result = await setBudgetLockedAction(id, locked);
        if (!result.ok) return fail(result.error);
        setBudgets((current) =>
          current.map((budget) => (budget.id === id ? result.data : budget)),
        );
      }),
    [fail, track],
  );

  const deleteBudget = useCallback(
    (id: string) =>
      track(async () => {
        const result = await deleteBudgetAction(id);
        if (!result.ok) return fail(result.error);
        setBudgets((current) => current.filter((budget) => budget.id !== id));
        // The database removes the budget's expenses with it; mirror that here.
        setExpenses((current) =>
          current.filter((expense) => expense.budgetId !== id),
        );
      }),
    [fail, track],
  );

  const addExpense = useCallback(
    (input: ExpenseInput) =>
      track(async () => {
        const result = await createExpenseAction(input);
        if (!result.ok) return fail(result.error);
        setExpenses((current) => [result.data, ...current]);
      }),
    [fail, track],
  );

  const updateExpense = useCallback(
    (id: string, input: ExpenseInput) =>
      track(async () => {
        const result = await updateExpenseAction(id, input);
        if (!result.ok) return fail(result.error);
        setExpenses((current) =>
          current.map((expense) => (expense.id === id ? result.data : expense)),
        );
      }),
    [fail, track],
  );

  const deleteExpense = useCallback(
    (id: string) =>
      track(async () => {
        const result = await deleteExpenseAction(id);
        if (!result.ok) return fail(result.error);
        setExpenses((current) => current.filter((expense) => expense.id !== id));
      }),
    [fail, track],
  );

  const sortedBudgets = useMemo(() => sortBudgetsByPeriod(budgets), [budgets]);
  const sortedExpenses = useMemo(() => sortExpensesByNewest(expenses), [expenses]);

  const budgetSummaries = useMemo(
    () => summarizeBudgets(sortedBudgets, expenses),
    [sortedBudgets, expenses],
  );

  const currentBudget = useMemo(() => activeBudget(sortedBudgets), [sortedBudgets]);

  const getBudget = useCallback(
    (id: string) => budgets.find((budget) => budget.id === id) ?? null,
    [budgets],
  );

  const getBudgetSummary = useCallback(
    (id: string) => budgetSummaries.find((entry) => entry.budget.id === id) ?? null,
    [budgetSummaries],
  );

  const expensesFor = useCallback(
    (budgetId: string) => sortExpensesByNewest(expensesForBudget(expenses, budgetId)),
    [expenses],
  );

  const budgetsCovering = useCallback(
    (date: DateKey) => budgetsForDate(budgets, date),
    [budgets],
  );

  const availableBalanceFor = useCallback(
    (budgetId: string, excludeExpenseId?: string) => {
      const budget = budgets.find((entry) => entry.id === budgetId);
      if (!budget) return 0;
      return calculateAvailableBalance(
        budget.amount,
        expensesForBudget(expenses, budgetId),
        excludeExpenseId,
      );
    },
    [budgets, expenses],
  );

  const isBudgetCompleted = useCallback((budget: Budget) => isCompleted(budget), []);

  const value = useMemo<TrackerContextValue>(
    () => ({
      hydrated: true,
      pending: inFlight > 0,
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
      getBudget,
      getBudgetSummary,
      expensesFor,
      budgetsCovering,
      availableBalanceFor,
      isBudgetCompleted,
    }),
    [
      inFlight,
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
