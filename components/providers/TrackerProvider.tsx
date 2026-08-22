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

import type {
  Budget,
  BudgetInput,
  BudgetSummary,
  TransferInput,
} from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import {
  budgetsForDate,
  budgetsForToday,
  isFullySpent,
  isPeriodEnded,
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
  createTransferAction,
  deleteBudgetAction,
  deleteExpenseAction,
  listBudgetsAction,
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
  /** Open allotments — everything the user can still spend against. */
  activeBudgetSummaries: BudgetSummary[];
  /**
   * Allotments spent down to exactly ₱0.00 and closed, newest first. Shown as a
   * read-only archive and deliberately absent from every other list.
   */
  completedBudgetSummaries: BudgetSummary[];
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

  /**
   * Records an expense. `completed` names the allotment if this write spent it
   * out, so the caller can say so in the same breath as "saved" rather than in
   * a second toast that replaces the first.
   */
  addExpense: (input: ExpenseInput) => Promise<ExpenseWriteOutcome>;
  updateExpense: (id: string, input: ExpenseInput) => Promise<ExpenseWriteOutcome>;
  deleteExpense: (id: string) => Promise<boolean>;
  /**
   * Moves money out of one allotment into a new one. `destination` is the
   * allotment created, so the caller can name it; `completed` is set when the
   * transfer took the source's last peso.
   */
  createTransfer: (input: TransferInput) => Promise<TransferWriteOutcome>;

  getBudget: (id: string) => Budget | null;
  getBudgetSummary: (id: string) => BudgetSummary | null;
  budgetsCovering: (date: DateKey) => Budget[];
  /**
   * What a budget can still fund. `excluding` is the expense being edited,
   * whose own amount must not count against the user twice.
   */
  availableBalanceFor: (budgetId: string, excluding?: Expense | null) => number;
  /** True when the budget's amount and dates are read-only. */
  isBudgetImmutable: (budget: Budget) => boolean;
  /** True when the budget is closed: no edits, no deletes, no unlock, ever. */
  isBudgetFullySpent: (budget: Budget) => boolean;
}

/** The result of writing an expense, and whether it closed its budget. */
export interface ExpenseWriteOutcome {
  saved: boolean;
  /** The budget this write spent out, if any. */
  completed: Budget | null;
}

/** The result of a transfer: what it created, and what it may have closed. */
export interface TransferWriteOutcome extends ExpenseWriteOutcome {
  destination: Budget | null;
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

  /**
   * Re-reads the budgets, the totals and the current page after a write.
   *
   * The budgets are re-read because a write can change their lifecycle, not
   * just their numbers: an expense that spends the last centavo closes its
   * allotment, and the screen has to stop offering it immediately.
   */
  const refresh = useCallback(async () => {
    const [budgetsResult, totalsResult] = await Promise.all([
      listBudgetsAction(),
      budgetTotalsAction(),
      fetchPage(query),
    ]);
    if (budgetsResult.ok) setBudgets(budgetsResult.data);
    if (totalsResult.ok) setTotals(totalsResult.data);
  }, [fetchPage, query]);

  /** Wraps a mutation so the UI can show that something is being saved. */
  const track = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
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

  /**
   * True when this write is what closed the budget.
   *
   * The transition happens without the user asking for it, so the caller has to
   * be able to say so — otherwise an allotment vanishes from every picker and
   * the next expense has nowhere to go for no visible reason.
   */
  const justClosed = useCallback(
    (budgetId: string, after: Budget): Budget | null => {
      const before = budgets.find((budget) => budget.id === budgetId);
      return before && !isFullySpent(before) && isFullySpent(after) ? after : null;
    },
    [budgets],
  );

  const REFUSED: ExpenseWriteOutcome = { saved: false, completed: null };

  const addExpense = useCallback(
    (input: ExpenseInput) =>
      track(async () => {
        const result = await createExpenseAction(input);
        if (!result.ok) {
          fail(result.error);
          return REFUSED;
        }
        const completed = justClosed(input.budgetId, result.data.budget);
        await refresh();
        return { saved: true, completed };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fail, justClosed, refresh, track],
  );

  const updateExpense = useCallback(
    (id: string, input: ExpenseInput) =>
      track(async () => {
        const result = await updateExpenseAction(id, input);
        if (!result.ok) {
          fail(result.error);
          return REFUSED;
        }
        const completed = justClosed(input.budgetId, result.data.budget);
        await refresh();
        return { saved: true, completed };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fail, justClosed, refresh, track],
  );

  const createTransfer = useCallback(
    (input: TransferInput) =>
      track(async (): Promise<TransferWriteOutcome> => {
        const result = await createTransferAction(input);
        if (!result.ok) {
          fail(result.error);
          return { saved: false, completed: null, destination: null };
        }

        // Whether the source closed is decided against the budgets held before
        // the refresh below replaces them.
        const completed = justClosed(input.sourceBudgetId, result.data.source);
        await refresh();
        return { saved: true, completed, destination: result.data.destination };
      }),
    [fail, justClosed, refresh, track],
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

  const activeBudgetSummaries = useMemo(
    () => budgetSummaries.filter((entry) => !isFullySpent(entry.budget)),
    [budgetSummaries],
  );

  /** Newest completion first: the archive reads as a history, not a backlog. */
  const completedBudgetSummaries = useMemo(
    () =>
      budgetSummaries
        .filter((entry) => isFullySpent(entry.budget))
        .sort(
          (a, b) =>
            (b.budget.completedAt ?? "").localeCompare(a.budget.completedAt ?? "") ||
            a.budget.id.localeCompare(b.budget.id),
        ),
    [budgetSummaries],
  );

  const isBudgetFullySpent = useCallback((budget: Budget) => isFullySpent(budget), []);

  const isBudgetImmutable = useCallback(
    (budget: Budget) => isFullySpent(budget) || isPeriodEnded(budget),
    [],
  );

  const value = useMemo<TrackerContextValue>(
    () => ({
      hydrated: true,
      pending: inFlight > 0,
      budgets: sortedBudgets,
      budgetSummaries,
      activeBudgetSummaries,
      completedBudgetSummaries,
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
      createTransfer,
      getBudget,
      getBudgetSummary,
      budgetsCovering,
      availableBalanceFor,
      isBudgetImmutable,
      isBudgetFullySpent,
    }),
    [
      inFlight,
      sortedBudgets,
      budgetSummaries,
      activeBudgetSummaries,
      completedBudgetSummaries,
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
      createTransfer,
      getBudget,
      getBudgetSummary,
      budgetsCovering,
      availableBalanceFor,
      isBudgetImmutable,
      isBudgetFullySpent,
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
