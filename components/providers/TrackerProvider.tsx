"use client";

/**
 * Client-side view of one user's tracker.
 *
 * The server is authoritative. Every mutation calls a server action, which
 * re-validates the request and resolves the owner from the session cookie, then
 * this provider applies what the server returned. Nothing is written locally
 * and hoped for: if the server refuses, local state does not change and the
 * reason is surfaced.
 *
 * The expense list is a *page*, not the whole set. Balances therefore come from
 * per-budget aggregates the database computes, so a user with ten thousand
 * expenses downloads twenty rows and a handful of totals rather than everything
 * they have ever recorded. The arithmetic is still the shared domain code, so
 * screen and records cannot disagree.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Budget, BudgetInput, BudgetSummary } from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import {
  budgetsForDate,
  budgetsForToday,
  isCompleted,
  sortBudgetsByPeriod,
  summarizeBudgetsFromTotals,
  type BudgetTotals,
} from "@/lib/budgets";
import { roundCurrency } from "@/lib/currency";
import {
  DEFAULT_PAGE_SIZE,
  paginationFor,
  type Pagination,
} from "@/lib/pagination";
import { todayKey, type DateKey } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
import type { ExpenseSort } from "@/lib/db/tracker";
import {
  budgetTotalsAction,
  createBudgetAction,
  createExpenseAction,
  deleteBudgetAction,
  deleteExpenseAction,
  listExpensesAction,
  setBudgetLockedAction,
  updateBudgetAction,
  updateExpenseAction,
} from "@/lib/server/tracker-actions";

/** What the expense list is currently showing. */
export interface ExpenseListQuery {
  page: number;
  pageSize: number;
  sort: ExpenseSort;
  budgetId: string | null;
}

const INITIAL_QUERY: ExpenseListQuery = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: "newest",
  budgetId: null,
};

interface TrackerContextValue {
  /** Server-rendered data arrives with the page, so this is always true. */
  hydrated: boolean;
  /** True while a mutation is in flight. */
  pending: boolean;
  budgets: Budget[];
  budgetSummaries: BudgetSummary[];
  /**
   * Budgets that could fund an expense dated today: those whose period covers
   * it, plus every general allotment. Several may apply at once — there is
   * deliberately no single "current budget".
   */
  todaysBudgets: Budget[];

  /** The current page of expenses, and where it sits in the whole set. */
  expenses: Expense[];
  expensePagination: Pagination;
  expenseQuery: ExpenseListQuery;
  /** True while a page, sort or filter change is being fetched. */
  expensesLoading: boolean;
  /** Applies a partial change; anything but a page change returns to page 1. */
  setExpenseQuery: (change: Partial<ExpenseListQuery>) => void;

  createBudget: (input: BudgetInput) => Promise<boolean>;
  updateBudget: (id: string, input: BudgetInput) => Promise<boolean>;
  setBudgetLocked: (id: string, locked: boolean) => Promise<boolean>;
  deleteBudget: (id: string) => Promise<boolean>;

  addExpense: (input: ExpenseInput) => Promise<boolean>;
  updateExpense: (id: string, input: ExpenseInput) => Promise<boolean>;
  deleteExpense: (id: string) => Promise<boolean>;

  getBudget: (id: string) => Budget | null;
  getBudgetSummary: (id: string) => BudgetSummary | null;
  budgetsCovering: (date: DateKey) => Budget[];
  /**
   * What a budget can still fund. `excluding` is the expense being edited,
   * whose own amount must not count against the user twice.
   */
  availableBalanceFor: (budgetId: string, excluding?: Expense | null) => number;
  isBudgetCompleted: (budget: Budget) => boolean;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

export function TrackerProvider({
  children,
  initialBudgets,
  initialTotals,
  initialExpenses,
  initialPagination,
}: {
  children: ReactNode;
  initialBudgets: Budget[];
  initialTotals: BudgetTotals[];
  initialExpenses: Expense[];
  initialPagination: Pagination;
}) {
  const { showToast } = useToast();
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets);
  const [totals, setTotals] = useState<BudgetTotals[]>(initialTotals);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [expensePagination, setExpensePagination] =
    useState<Pagination>(initialPagination);
  const [query, setQuery] = useState<ExpenseListQuery>({
    ...INITIAL_QUERY,
    pageSize: initialPagination.pageSize,
  });
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const inFlightRef = useRef(0);

  /*
   * Guards against an out-of-order response.
   *
   * Two page changes in quick succession can return in either order; only the
   * newest request may write to state, or the list would settle on the wrong
   * page.
   */
  const requestRef = useRef(0);
  /** The first render already has the server's page; do not refetch it. */
  const primedRef = useRef(false);

  const fetchPage = useCallback(
    async (next: ExpenseListQuery) => {
      const request = (requestRef.current += 1);
      setExpensesLoading(true);

      try {
        const result = await listExpensesAction(next);
        if (request !== requestRef.current) return;

        if (!result.ok) {
          showToast(result.error);
          return;
        }

        setExpenses(result.data.data);
        setExpensePagination(result.data.pagination);

        /*
         * The server may have pulled the page back into range — but only write
         * that back when it actually differs.
         *
         * `query` drives the fetching effect, so returning a fresh object with
         * identical values would re-trigger it and the list would fetch in a
         * loop for as long as it was on screen.
         */
        setQuery((current) =>
          current.page === result.data.pagination.page
            ? current
            : { ...current, page: result.data.pagination.page },
        );
      } finally {
        if (request === requestRef.current) setExpensesLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (!primedRef.current) {
      primedRef.current = true;
      return;
    }
    void fetchPage(query);
  }, [query, fetchPage]);

  const setExpenseQuery = useCallback((change: Partial<ExpenseListQuery>) => {
    setQuery((current) => {
      // Any change other than the page itself starts again at page 1: after a
      // filter narrows the data, page 7 may no longer exist.
      const resets = "page" in change && Object.keys(change).length === 1;
      return { ...current, ...change, page: resets ? change.page! : 1 };
    });
  }, []);

  /** Re-reads the totals and the current page after a write. */
  const refresh = useCallback(async () => {
    const [totalsResult] = await Promise.all([
      budgetTotalsAction(),
      fetchPage(query),
    ]);
    if (totalsResult.ok) setTotals(totalsResult.data);
  }, [fetchPage, query]);

  /** Wraps a mutation so the UI can show that something is being saved. */
  const track = useCallback(async (run: () => Promise<boolean>) => {
    inFlightRef.current += 1;
    setInFlight(inFlightRef.current);
    try {
      return await run();
    } finally {
      inFlightRef.current -= 1;
      setInFlight(inFlightRef.current);
    }
  }, []);

  /** Reports a refusal without changing local state. */
  const fail = useCallback(
    (message: string) => {
      showToast(message);
      return false;
    },
    [showToast],
  );

  const createBudget = useCallback(
    (input: BudgetInput) =>
      track(async () => {
        const result = await createBudgetAction(input);
        if (!result.ok) return fail(result.error);
        setBudgets((current) => [result.data, ...current]);
        return true;
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
        return true;
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
        return true;
      }),
    [fail, track],
  );

  const deleteBudget = useCallback(
    (id: string) =>
      track(async () => {
        const result = await deleteBudgetAction(id);
        if (!result.ok) return fail(result.error);
        setBudgets((current) => current.filter((budget) => budget.id !== id));
        // The database removes the budget's expenses with it, so the page and
        // the totals both have to be re-read rather than patched.
        await refresh();
        return true;
      }),
    [fail, refresh, track],
  );

  const addExpense = useCallback(
    (input: ExpenseInput) =>
      track(async () => {
        const result = await createExpenseAction(input);
        if (!result.ok) return fail(result.error);
        await refresh();
        return true;
      }),
    [fail, refresh, track],
  );

  const updateExpense = useCallback(
    (id: string, input: ExpenseInput) =>
      track(async () => {
        const result = await updateExpenseAction(id, input);
        if (!result.ok) return fail(result.error);
        await refresh();
        return true;
      }),
    [fail, refresh, track],
  );

  const deleteExpense = useCallback(
    (id: string) =>
      track(async () => {
        const result = await deleteExpenseAction(id);
        if (!result.ok) return fail(result.error);
        await refresh();
        return true;
      }),
    [fail, refresh, track],
  );

  const sortedBudgets = useMemo(() => sortBudgetsByPeriod(budgets), [budgets]);

  const budgetSummaries = useMemo(
    () => summarizeBudgetsFromTotals(sortedBudgets, totals),
    [sortedBudgets, totals],
  );

  const todaysBudgets = useMemo(() => budgetsForToday(sortedBudgets), [sortedBudgets]);

  const getBudget = useCallback(
    (id: string) => budgets.find((budget) => budget.id === id) ?? null,
    [budgets],
  );

  const getBudgetSummary = useCallback(
    (id: string) => budgetSummaries.find((entry) => entry.budget.id === id) ?? null,
    [budgetSummaries],
  );

  /** Budgets eligible to fund an expense on `date`, best match first. */
  const budgetsCovering = useCallback(
    (date: DateKey) => budgetsForDate(budgets, date),
    [budgets],
  );

  const availableBalanceFor = useCallback(
    (budgetId: string, excluding?: Expense | null) => {
      const budget = budgets.find((entry) => entry.id === budgetId);
      if (!budget) return 0;

      const spent = totals.find((entry) => entry.budgetId === budgetId)?.totalExpenses ?? 0;
      // An expense being edited is already inside `spent`; leaving it there
      // would measure the new amount against a balance it has already reduced.
      const credit = excluding?.budgetId === budgetId ? excluding.amount : 0;

      return roundCurrency(budget.amount - spent + credit);
    },
    [budgets, totals],
  );

  const isBudgetCompleted = useCallback((budget: Budget) => isCompleted(budget), []);

  const value = useMemo<TrackerContextValue>(
    () => ({
      hydrated: true,
      pending: inFlight > 0,
      budgets: sortedBudgets,
      budgetSummaries,
      todaysBudgets,
      expenses,
      expensePagination,
      expenseQuery: query,
      expensesLoading,
      setExpenseQuery,
      createBudget,
      updateBudget,
      setBudgetLocked,
      deleteBudget,
      addExpense,
      updateExpense,
      deleteExpense,
      getBudget,
      getBudgetSummary,
      budgetsCovering,
      availableBalanceFor,
      isBudgetCompleted,
    }),
    [
      inFlight,
      sortedBudgets,
      budgetSummaries,
      todaysBudgets,
      expenses,
      expensePagination,
      query,
      expensesLoading,
      setExpenseQuery,
      createBudget,
      updateBudget,
      setBudgetLocked,
      deleteBudget,
      addExpense,
      updateExpense,
      deleteExpense,
      getBudget,
      getBudgetSummary,
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

/** Re-exported so callers need not reach into the pagination module. */
export { paginationFor };
