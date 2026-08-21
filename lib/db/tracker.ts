/**
 * Budget and expense storage.
 *
 * Every statement filters on `user_id`, and that value always comes from the
 * session — never from the request body. An id belonging to another account
 * simply matches no rows, so a tampered request reads as "not found" rather
 * than leaking or mutating someone else's data.
 */

import { randomUUID } from "node:crypto";

import { getDatabase, withTransaction, type SqlExecutor } from "@/lib/db/client";
import { clampPageSize, offsetFor, paginationFor, type Page } from "@/lib/pagination";
import type { Budget, BudgetInput, BudgetLifecycle } from "@/types/budget";
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
  status: BudgetLifecycle;
  completed_at: Date | string | null;
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
    status: row.status,
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
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
  "id, name, amount_centavos, start_date, end_date, locked, status, completed_at, created_at, updated_at";
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

/**
 * Why every write below runs in a transaction.
 *
 * "Is there enough left in this budget?" is a question about a sum of rows, and
 * the answer stops being true the moment anyone else writes one. Reading the
 * balance, deciding, and writing therefore have to be one indivisible step:
 * otherwise two expenses submitted at the same instant both read ₱500
 * remaining, both decide they fit, and both commit — spending the same ₱500
 * twice. The budget row is locked with `SELECT … FOR UPDATE`, so the second
 * request waits for the first to commit and then reads the balance it actually
 * left behind.
 *
 * The same transaction carries the completion: a budget that lands on exactly
 * ₱0.00 is closed in the step that spent its last centavo, so there is no
 * window in which it is empty but still accepting expenses.
 */

/** Why a write against a budget was refused. */
export type WriteRefusal =
  /** No such row for this user — including a budget belonging to someone else. */
  | "not-found"
  /** The budget is fully spent, so it and its expenses are immutable. */
  | "locked"
  /** The amount exceeds what the budget has left. */
  | "insufficient";

export type WriteResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: WriteRefusal; remaining?: number };

interface LockedBudget {
  id: string;
  amount_centavos: string | number;
  status: BudgetLifecycle;
}

/**
 * Takes the row lock on one budget for the rest of the transaction.
 *
 * `FOR UPDATE` is what serialises concurrent spending: a second transaction
 * asking for the same row blocks here until the first commits or rolls back.
 * Ownership is part of the predicate, so another account's budget is simply not
 * found rather than briefly locked.
 */
async function lockBudget(
  tx: SqlExecutor,
  userId: string,
  budgetId: string,
): Promise<LockedBudget | null> {
  const { rows } = await tx.query<LockedBudget>(
    `SELECT id, amount_centavos, status
       FROM budgets
      WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
    [budgetId, userId],
  );
  return rows[0] ?? null;
}

/** What a budget has spent, read inside the transaction that holds its lock. */
async function spentOn(
  tx: SqlExecutor,
  budgetId: string,
  excludeExpenseId?: string,
): Promise<number> {
  const params: unknown[] = [budgetId];
  let where = "budget_id = $1";
  if (excludeExpenseId) {
    params.push(excludeExpenseId);
    where += ` AND id <> $${params.length}`;
  }

  const { rows } = await tx.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount_centavos), 0) AS total FROM expenses WHERE ${where}`,
    params,
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Closes the budget if its last centavo has just been spent.
 *
 * Called after every write that can move a balance, so the rule has exactly one
 * implementation. "Exactly zero" is meant literally: ₱1 left is still an open
 * budget, and a negative balance is not a completion either. A budget with no
 * expenses at all is never closed — a ₱0 allotment nobody has touched was not
 * spent out, it was never used.
 *
 * The transition is one-way. Nothing here ever moves a budget back to active.
 */
async function settleBudget(
  tx: SqlExecutor,
  userId: string,
  budgetId: string,
): Promise<Budget | null> {
  const { rows } = await tx.query<
    BudgetRow & { spent_centavos: string | number; expense_count: string | number }
  >(
    `SELECT ${BUDGET_COLUMNS},
            (SELECT COALESCE(SUM(amount_centavos), 0) FROM expenses e WHERE e.budget_id = budgets.id)
              AS spent_centavos,
            (SELECT COUNT(*) FROM expenses e WHERE e.budget_id = budgets.id)
              AS expense_count
       FROM budgets
      WHERE id = $1 AND user_id = $2`,
    [budgetId, userId],
  );

  const row = rows[0];
  if (!row) return null;
  if (row.status === "fully_spent") return toBudget(row);

  const remaining = Number(row.amount_centavos) - Number(row.spent_centavos);
  if (remaining !== 0 || Number(row.expense_count) === 0) return toBudget(row);

  const { rows: closed } = await tx.query<BudgetRow>(
    `UPDATE budgets
        SET status = 'fully_spent', completed_at = now(), locked = true, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'active'
      RETURNING ${BUDGET_COLUMNS}`,
    [budgetId, userId],
  );
  return closed[0] ? toBudget(closed[0]) : toBudget(row);
}

/**
 * Edits a budget, unless it has been fully spent.
 *
 * `status = 'active'` is part of the WHERE clause rather than a check the
 * caller makes first: a request that reaches this function directly, bypassing
 * every screen, still cannot touch a closed budget.
 */
export async function updateBudgetRow(
  userId: string,
  budgetId: string,
  input: BudgetInput,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ budget: Budget }>> {
  return withTransaction(db, async (tx) => {
    const locked = await lockBudget(tx, userId, budgetId);
    if (!locked) return { ok: false as const, reason: "not-found" as const };
    if (locked.status === "fully_spent") {
      return { ok: false as const, reason: "locked" as const };
    }

    await tx.query(
      `UPDATE budgets
          SET name = $3, amount_centavos = $4, start_date = $5, end_date = $6,
              locked = true, updated_at = now()
        WHERE id = $2 AND user_id = $1 AND status = 'active'`,
      [
        userId,
        budgetId,
        input.name,
        toCentavos(input.amount),
        input.startDate,
        input.endDate,
      ],
    );

    // Lowering the allotment to exactly what has already been spent closes it,
    // for the same reason spending the last centavo does: nothing is left.
    const budget = await settleBudget(tx, userId, budgetId);
    if (!budget) return { ok: false as const, reason: "not-found" as const };
    return { ok: true as const, budget };
  });
}

/**
 * Toggles the manual edit lock.
 *
 * This is the user's own lock, and it has no bearing on a fully spent budget:
 * that one is closed by its status, and there is no unlock for it.
 */
export async function setBudgetLockedRow(
  userId: string,
  budgetId: string,
  locked: boolean,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ budget: Budget }>> {
  const { rows } = await db.query<BudgetRow>(
    `UPDATE budgets SET locked = $3, updated_at = now()
      WHERE id = $2 AND user_id = $1 AND status = 'active'
      RETURNING ${BUDGET_COLUMNS}`,
    [userId, budgetId, locked],
  );

  if (rows[0]) return { ok: true, budget: toBudget(rows[0]) };
  return { ok: false, reason: await refusalFor(db, userId, budgetId) };
}

export async function deleteBudgetRow(
  userId: string,
  budgetId: string,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ id: string }>> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM budgets
      WHERE id = $2 AND user_id = $1 AND status = 'active'
      RETURNING id`,
    [userId, budgetId],
  );

  if (rows[0]) return { ok: true, id: rows[0].id };
  return { ok: false, reason: await refusalFor(db, userId, budgetId) };
}

/**
 * Separates "there is no such budget" from "it is closed".
 *
 * Both make a statement match no rows, and the two deserve different answers:
 * one is a stale id, the other is the rule doing its job.
 */
async function refusalFor(
  db: SqlExecutor,
  userId: string,
  budgetId: string,
): Promise<WriteRefusal> {
  const { rows } = await db.query<{ status: BudgetLifecycle }>(
    `SELECT status FROM budgets WHERE id = $1 AND user_id = $2`,
    [budgetId, userId],
  );
  if (!rows[0]) return "not-found";
  return rows[0].status === "fully_spent" ? "locked" : "not-found";
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

/**
 * Records an expense, or refuses.
 *
 * Validate, insert, recalculate, close — all under the budget's row lock and
 * all in one transaction. If any step throws, nothing is written: there is no
 * state where the expense exists but the budget was never re-checked, and none
 * where a budget is marked closed without the expense that closed it.
 */
export async function insertExpense(
  userId: string,
  input: ExpenseInput,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ expense: Expense; budget: Budget }>> {
  const amount = toCentavos(input.amount);

  return withTransaction(db, async (tx) => {
    // Re-checked against the same user, so an expense can never be attached to
    // an allotment the caller does not own.
    const budget = await lockBudget(tx, userId, input.budgetId);
    if (!budget) return { ok: false as const, reason: "not-found" as const };
    if (budget.status === "fully_spent") {
      return { ok: false as const, reason: "locked" as const };
    }

    const remaining = Number(budget.amount_centavos) - (await spentOn(tx, budget.id));
    if (amount > remaining) {
      return {
        ok: false as const,
        reason: "insufficient" as const,
        remaining: fromCentavos(remaining),
      };
    }

    const { rows } = await tx.query<ExpenseRow>(
      `INSERT INTO expenses (id, user_id, budget_id, name, amount_centavos, expense_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${EXPENSE_COLUMNS}`,
      [randomUUID(), userId, input.budgetId, input.name, amount, input.expenseDate],
    );

    const settled = await settleBudget(tx, userId, input.budgetId);
    if (!settled) return { ok: false as const, reason: "not-found" as const };

    return { ok: true as const, expense: toExpense(rows[0]), budget: settled };
  });
}

/**
 * Edits an expense, or refuses.
 *
 * An expense charged to a fully spent budget cannot be changed at all — not its
 * amount, not its name, not its date, and above all not which budget it belongs
 * to, which would rewrite a closed budget's total from the outside. A move
 * *into* a closed budget is refused for the same reason.
 */
export async function updateExpenseRow(
  userId: string,
  expenseId: string,
  input: ExpenseInput,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ expense: Expense; budget: Budget }>> {
  const amount = toCentavos(input.amount);

  return withTransaction(db, async (tx) => {
    const { rows: current } = await tx.query<{ budget_id: string }>(
      `SELECT budget_id FROM expenses WHERE id = $1 AND user_id = $2`,
      [expenseId, userId],
    );
    if (!current[0]) return { ok: false as const, reason: "not-found" as const };

    const previousBudgetId = current[0].budget_id;

    /*
     * Both budgets are locked before either is read, and always in id order.
     * Two moves in opposite directions between the same pair would otherwise
     * be able to take the locks in opposite orders and deadlock.
     */
    const ids = Array.from(new Set([previousBudgetId, input.budgetId])).sort();
    const locks = new Map<string, LockedBudget>();
    for (const id of ids) {
      const row = await lockBudget(tx, userId, id);
      if (!row) return { ok: false as const, reason: "not-found" as const };
      if (row.status === "fully_spent") {
        return { ok: false as const, reason: "locked" as const };
      }
      locks.set(id, row);
    }

    const target = locks.get(input.budgetId)!;
    const spent = await spentOn(tx, target.id, expenseId);
    const remaining = Number(target.amount_centavos) - spent;
    if (amount > remaining) {
      return {
        ok: false as const,
        reason: "insufficient" as const,
        remaining: fromCentavos(remaining),
      };
    }

    const { rows } = await tx.query<ExpenseRow>(
      `UPDATE expenses
          SET budget_id = $3, name = $4, amount_centavos = $5, expense_date = $6,
              updated_at = now()
        WHERE id = $2 AND user_id = $1
        RETURNING ${EXPENSE_COLUMNS}`,
      [userId, expenseId, input.budgetId, input.name, amount, input.expenseDate],
    );
    if (!rows[0]) return { ok: false as const, reason: "not-found" as const };

    // Both budgets are re-evaluated: the one that gained the expense may now be
    // spent out, and the one that lost it had its balance move too.
    for (const id of ids) {
      if (id !== input.budgetId) await settleBudget(tx, userId, id);
    }
    const settled = await settleBudget(tx, userId, input.budgetId);
    if (!settled) return { ok: false as const, reason: "not-found" as const };

    return { ok: true as const, expense: toExpense(rows[0]), budget: settled };
  });
}

/**
 * Deletes an expense, unless its budget has been closed.
 *
 * Deleting from a fully spent budget would reopen a settled record and change
 * what past reports say, which is exactly what completion exists to prevent.
 */
export async function deleteExpenseRow(
  userId: string,
  expenseId: string,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ id: string }>> {
  return withTransaction(db, async (tx) => {
    const { rows: current } = await tx.query<{ budget_id: string }>(
      `SELECT budget_id FROM expenses WHERE id = $1 AND user_id = $2`,
      [expenseId, userId],
    );
    if (!current[0]) return { ok: false as const, reason: "not-found" as const };

    const budget = await lockBudget(tx, userId, current[0].budget_id);
    if (!budget) return { ok: false as const, reason: "not-found" as const };
    if (budget.status === "fully_spent") {
      return { ok: false as const, reason: "locked" as const };
    }

    const { rows } = await tx.query<{ id: string }>(
      `DELETE FROM expenses WHERE id = $2 AND user_id = $1 RETURNING id`,
      [userId, expenseId],
    );
    if (!rows[0]) return { ok: false as const, reason: "not-found" as const };

    await settleBudget(tx, userId, budget.id);
    return { ok: true as const, id: rows[0].id };
  });
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
