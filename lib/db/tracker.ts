/**
 * Budget and expense storage.
 *
 * Every statement filters on `user_id`, and that value always comes from the
 * session — never from the request body. An id belonging to another account
 * simply matches no rows, so a tampered request reads as "not found" rather
 * than leaking or mutating someone else's data.
 */

import { randomUUID } from "node:crypto";

import { getDatabase, type SqlExecutor } from "@/lib/db/client";
import { clampPageSize, offsetFor, paginationFor, type Page } from "@/lib/pagination";
import type { Budget, BudgetInput } from "@/types/budget";
import type { Expense, ExpenseInput } from "@/types/expense";
import { roundCurrency } from "@/lib/currency";

/** Money crosses the boundary as integer centavos. */
export function toCentavos(pesos: number): number {
  return Math.round(roundCurrency(pesos) * 100);
}

export function fromCentavos(centavos: number | string): number {
  return roundCurrency(Number(centavos) / 100);
}

interface BudgetRow {
  id: string;
  name: string;
  amount_centavos: string | number;
  /** NULL for a general allotment with no date restriction. */
  start_date: string | null;
  end_date: string | null;
  locked: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ExpenseRow {
  id: string;
  budget_id: string;
  name: string;
  amount_centavos: string | number;
  expense_date: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    name: row.name,
    amount: fromCentavos(row.amount_centavos),
    // A half-set period cannot be stored (see migration 003), so a NULL on
    // either side means the allotment carries no date restriction at all.
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    locked: row.locked,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    budgetId: row.budget_id,
    name: row.name,
    amount: fromCentavos(row.amount_centavos),
    expenseDate: row.expense_date,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const BUDGET_COLUMNS =
  "id, name, amount_centavos, start_date, end_date, locked, created_at, updated_at";
const EXPENSE_COLUMNS =
  "id, budget_id, name, amount_centavos, expense_date, created_at, updated_at";

/* ----------------------------------------------------------------- budgets */

export async function listBudgets(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<Budget[]> {
  const { rows } = await db.query<BudgetRow>(
    `SELECT ${BUDGET_COLUMNS} FROM budgets
      WHERE user_id = $1
      ORDER BY start_date DESC NULLS LAST, end_date DESC NULLS LAST, id`,
    [userId],
  );
  return rows.map(toBudget);
}

export async function insertBudget(
  userId: string,
  input: BudgetInput,
  db: SqlExecutor = getDatabase(),
): Promise<Budget> {
  const { rows } = await db.query<BudgetRow>(
    `INSERT INTO budgets (id, user_id, name, amount_centavos, start_date, end_date, locked)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING ${BUDGET_COLUMNS}`,
    [
      randomUUID(),
      userId,
      input.name,
      toCentavos(input.amount),
      input.startDate,
      input.endDate,
    ],
  );
  return toBudget(rows[0]);
}

export async function updateBudgetRow(
  userId: string,
  budgetId: string,
  input: BudgetInput,
  db: SqlExecutor = getDatabase(),
): Promise<Budget | null> {
  const { rows } = await db.query<BudgetRow>(
    `UPDATE budgets
        SET name = $3, amount_centavos = $4, start_date = $5, end_date = $6,
            locked = true, updated_at = now()
      WHERE id = $2 AND user_id = $1
      RETURNING ${BUDGET_COLUMNS}`,
    [
      userId,
      budgetId,
      input.name,
      toCentavos(input.amount),
      input.startDate,
      input.endDate,
    ],
  );
  return rows[0] ? toBudget(rows[0]) : null;
}

export async function setBudgetLockedRow(
  userId: string,
  budgetId: string,
  locked: boolean,
  db: SqlExecutor = getDatabase(),
): Promise<Budget | null> {
  const { rows } = await db.query<BudgetRow>(
    `UPDATE budgets SET locked = $3, updated_at = now()
      WHERE id = $2 AND user_id = $1
      RETURNING ${BUDGET_COLUMNS}`,
    [userId, budgetId, locked],
  );
  return rows[0] ? toBudget(rows[0]) : null;
}

export async function deleteBudgetRow(
  userId: string,
  budgetId: string,
  db: SqlExecutor = getDatabase(),
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM budgets WHERE id = $2 AND user_id = $1 RETURNING id`,
    [userId, budgetId],
  );
  return rows.length > 0;
}

/* ---------------------------------------------------------------- expenses */

export async function listExpenses(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<Expense[]> {
  const { rows } = await db.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses
      WHERE user_id = $1
      ORDER BY expense_date DESC, created_at DESC, id`,
    [userId],
  );
  return rows.map(toExpense);
}

export async function insertExpense(
  userId: string,
  input: ExpenseInput,
  db: SqlExecutor = getDatabase(),
): Promise<Expense | null> {
  // The budget is re-checked against the same user, so an expense can never be
  // attached to an allotment the caller does not own.
  const { rows: owned } = await db.query<{ id: string }>(
    `SELECT id FROM budgets WHERE id = $1 AND user_id = $2`,
    [input.budgetId, userId],
  );
  if (owned.length === 0) return null;

  const { rows } = await db.query<ExpenseRow>(
    `INSERT INTO expenses (id, user_id, budget_id, name, amount_centavos, expense_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${EXPENSE_COLUMNS}`,
    [
      randomUUID(),
      userId,
      input.budgetId,
      input.name,
      toCentavos(input.amount),
      input.expenseDate,
    ],
  );
  return toExpense(rows[0]);
}

export async function updateExpenseRow(
  userId: string,
  expenseId: string,
  input: ExpenseInput,
  db: SqlExecutor = getDatabase(),
): Promise<Expense | null> {
  const { rows: owned } = await db.query<{ id: string }>(
    `SELECT id FROM budgets WHERE id = $1 AND user_id = $2`,
    [input.budgetId, userId],
  );
  if (owned.length === 0) return null;

  const { rows } = await db.query<ExpenseRow>(
    `UPDATE expenses
        SET budget_id = $3, name = $4, amount_centavos = $5, expense_date = $6,
            updated_at = now()
      WHERE id = $2 AND user_id = $1
      RETURNING ${EXPENSE_COLUMNS}`,
    [
      userId,
      expenseId,
      input.budgetId,
      input.name,
      toCentavos(input.amount),
      input.expenseDate,
    ],
  );
  return rows[0] ? toExpense(rows[0]) : null;
}

export async function deleteExpenseRow(
  userId: string,
  expenseId: string,
  db: SqlExecutor = getDatabase(),
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM expenses WHERE id = $2 AND user_id = $1 RETURNING id`,
    [userId, expenseId],
  );
  return rows.length > 0;
}


/* ------------------------------------------------- aggregates and paging -- */

/** One budget's spend, computed by the database rather than in the browser. */
export interface BudgetTotal {
  budgetId: string;
  totalExpenses: number;
  expenseCount: number;
}

/**
 * Per-budget totals for one user.
 *
 * This is what lets the expense list be paginated. A balance is
 * `amount − SUM(expenses)`, and summing in SQL means the client never has to
 * hold every row to know what a budget has left — one small result set instead
 * of an unbounded one.
 */
export async function budgetTotals(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<BudgetTotal[]> {
  const { rows } = await db.query<{
    budget_id: string;
    total_centavos: string | number;
    expense_count: string | number;
  }>(
    `SELECT budget_id,
            COALESCE(SUM(amount_centavos), 0) AS total_centavos,
            COUNT(*) AS expense_count
       FROM expenses
      WHERE user_id = $1
      GROUP BY budget_id`,
    [userId],
  );

  return rows.map((row) => ({
    budgetId: row.budget_id,
    totalExpenses: fromCentavos(row.total_centavos),
    expenseCount: Number(row.expense_count),
  }));
}

/**
 * Per-budget spend strictly before a date.
 *
 * History chains each budget's balance forward through its own days. When the
 * view only fetches a window, the days before it still have to be accounted
 * for — otherwise a report on August would open every budget at its full
 * allotment as though July had never happened. One grouped sum answers that
 * without shipping the earlier rows.
 */
export async function budgetTotalsBefore(
  userId: string,
  beforeDate: string,
  db: SqlExecutor = getDatabase(),
): Promise<BudgetTotal[]> {
  const { rows } = await db.query<{
    budget_id: string;
    total_centavos: string | number;
    expense_count: string | number;
  }>(
    `SELECT budget_id,
            COALESCE(SUM(amount_centavos), 0) AS total_centavos,
            COUNT(*) AS expense_count
       FROM expenses
      WHERE user_id = $1 AND expense_date < $2
      GROUP BY budget_id`,
    [userId, beforeDate],
  );

  return rows.map((row) => ({
    budgetId: row.budget_id,
    totalExpenses: fromCentavos(row.total_centavos),
    expenseCount: Number(row.expense_count),
  }));
}

/** How a list of expenses is ordered. Applied in SQL, across the whole set. */
export type ExpenseSort = "newest" | "oldest" | "highest" | "lowest";

const SORT_CLAUSES: Record<ExpenseSort, string> = {
  // Ties break on created_at then id so paging is stable: without a total
  // order, a row can appear on two pages or on none.
  newest: "expense_date DESC, created_at DESC, id DESC",
  oldest: "expense_date ASC, created_at ASC, id ASC",
  highest: "amount_centavos DESC, expense_date DESC, id DESC",
  lowest: "amount_centavos ASC, expense_date ASC, id ASC",
};

export interface ExpenseQuery {
  page?: number;
  pageSize?: number;
  sort?: ExpenseSort;
  /** Restrict to one allotment. */
  budgetId?: string | null;
  /** Inclusive date bounds, as `YYYY-MM-DD`. */
  from?: string | null;
  to?: string | null;
}

/**
 * One page of a user's expenses.
 *
 * Sorting and filtering both happen in the query, so "highest amount" means the
 * highest of *all* the user's expenses rather than the highest of whichever
 * page happens to be loaded. The sort key is looked up from a fixed table —
 * never interpolated from the request — and every other value is a bound
 * parameter.
 */
export async function listExpensesPage(
  userId: string,
  query: ExpenseQuery = {},
  db: SqlExecutor = getDatabase(),
): Promise<Page<Expense>> {
  const pageSize = clampPageSize(query.pageSize);
  const order = SORT_CLAUSES[query.sort ?? "newest"] ?? SORT_CLAUSES.newest;

  const conditions = ["user_id = $1"];
  const params: unknown[] = [userId];

  if (query.budgetId) {
    params.push(query.budgetId);
    conditions.push(`budget_id = $${params.length}`);
  }
  if (query.from) {
    params.push(query.from);
    conditions.push(`expense_date >= $${params.length}`);
  }
  if (query.to) {
    params.push(query.to);
    conditions.push(`expense_date <= $${params.length}`);
  }

  const where = conditions.join(" AND ");

  const { rows: counted } = await db.query<{ total: string | number }>(
    `SELECT COUNT(*) AS total FROM expenses WHERE ${where}`,
    params,
  );
  const totalItems = Number(counted[0]?.total ?? 0);

  // Resolve the page against the real total first: a filter that shrinks the
  // result set must not leave the caller on an empty page.
  const pagination = paginationFor(totalItems, query.page ?? 1, pageSize);

  if (totalItems === 0) return { data: [], pagination };

  const { rows } = await db.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses
      WHERE ${where}
      ORDER BY ${order}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.pageSize, offsetFor(pagination.page, pagination.pageSize)],
  );

  return { data: rows.map(toExpense), pagination };
}

/** Every expense matching a filter, for an export that must not be truncated. */
export async function listExpensesMatching(
  userId: string,
  query: Omit<ExpenseQuery, "page" | "pageSize"> = {},
  db: SqlExecutor = getDatabase(),
): Promise<Expense[]> {
  const conditions = ["user_id = $1"];
  const params: unknown[] = [userId];

  if (query.budgetId) {
    params.push(query.budgetId);
    conditions.push(`budget_id = $${params.length}`);
  }
  if (query.from) {
    params.push(query.from);
    conditions.push(`expense_date >= $${params.length}`);
  }
  if (query.to) {
    params.push(query.to);
    conditions.push(`expense_date <= $${params.length}`);
  }

  const { rows } = await db.query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses
      WHERE ${conditions.join(" AND ")}
      ORDER BY expense_date DESC, created_at DESC, id`,
    params,
  );

  return rows.map(toExpense);
}

/** Everything the tracker needs for one user, in one round trip each. */
export async function loadTrackerData(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<{ budgets: Budget[]; expenses: Expense[] }> {
  const [budgets, expenses] = await Promise.all([
    listBudgets(userId, db),
    listExpenses(userId, db),
  ]);
  return { budgets, expenses };
}
