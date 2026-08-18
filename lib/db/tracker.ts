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
  start_date: string;
  end_date: string;
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
    startDate: row.start_date,
    endDate: row.end_date,
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
      ORDER BY start_date DESC, end_date DESC, id`,
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
