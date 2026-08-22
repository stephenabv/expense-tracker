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
import type {
  Budget,
  BudgetAllocation,
  BudgetInput,
  BudgetLifecycle,
  BudgetMerge,
  BudgetMergeSource,
  MergeInput,
  TransferInput,
} from "@/types/budget";
import type { Expense, ExpenseInput, ExpenseKind } from "@/types/expense";
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
  allocation_type: BudgetAllocation;
  source_budget_id: string | null;
  source_transaction_id: string | null;
  funded_amount_centavos: string | number;
  merged_into_budget_id: string | null;
  merged_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ExpenseRow {
  id: string;
  budget_id: string;
  name: string;
  amount_centavos: string | number;
  expense_date: string;
  kind: ExpenseKind;
  /**
   * The allotment a transfer created, read back from the destination budget.
   *
   * Stored on one side only — `budgets.source_transaction_id` — so the link
   * cannot be recorded in two places and disagree with itself.
   */
  transfer_budget_id?: string | null;
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
    allocationType: row.allocation_type,
    sourceBudgetId: row.source_budget_id,
    sourceTransactionId: row.source_transaction_id,
    fundedAmount: fromCentavos(row.funded_amount_centavos),
    mergedIntoBudgetId: row.merged_into_budget_id,
    mergedAt: row.merged_at === null ? null : iso(row.merged_at),
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
    kind: row.kind,
    transferBudgetId: row.transfer_budget_id ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const BUDGET_COLUMNS =
  "id, name, amount_centavos, start_date, end_date, locked, status, completed_at, " +
  "allocation_type, source_budget_id, source_transaction_id, funded_amount_centavos, " +
  "merged_into_budget_id, merged_at, created_at, updated_at";

const EXPENSE_COLUMNS =
  "id, budget_id, name, amount_centavos, expense_date, kind, created_at, updated_at";

/*
 * Reading expenses back with the allotment each transfer created.
 *
 * The link is a correlated lookup, not a stored column: it lives on the budget
 * the transfer produced, and duplicating it on the transaction would give one
 * fact two homes that could disagree. Writes use `EXPENSE_COLUMNS` above and
 * fill the link in from what they just created.
 */
const EXPENSE_SELECT =
  "e.id, e.budget_id, e.name, e.amount_centavos, e.expense_date, e.kind, " +
  "(SELECT b.id FROM budgets b WHERE b.source_transaction_id = e.id) AS transfer_budget_id, " +
  "e.created_at, e.updated_at";

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
    // A directly created allotment is entirely the user's own money, so its
    // funded figure is its whole amount.
    `INSERT INTO budgets (id, user_id, name, amount_centavos, start_date, end_date,
                          locked, funded_amount_centavos)
     VALUES ($1, $2, $3, $4, $5, $6, true, $4)
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
  | "insufficient"
  /**
   * The row is a committed budget transfer, or an allotment one created.
   * Changing either would move money that has already been accounted for.
   */
  | "transfer"
  /** The budget funded another allotment, so deleting it would strand it. */
  | "has-transfers"
  /**
   * The budget was folded into another one. Its expenses live there now, so
   * changing it here would rewrite a record of what it held.
   */
  | "merged";

export type WriteResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: WriteRefusal; remaining?: number };

interface LockedBudget {
  id: string;
  amount_centavos: string | number;
  status: BudgetLifecycle;
  allocation_type: BudgetAllocation;
}

/**
 * Why this budget cannot be written to, or `null` if it can.
 *
 * Both closed states refuse every write, and both are permanent — but they are
 * not the same fact, and a caller that conflated them would tell someone their
 * allotment was spent out when it had actually been folded into another one.
 */
function closedRefusal(budget: { status: BudgetLifecycle }): WriteRefusal | null {
  if (budget.status === "fully_spent") return "locked";
  if (budget.status === "merged") return "merged";
  return null;
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
    `SELECT id, amount_centavos, status, allocation_type
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
    BudgetRow & { out_centavos: string | number; out_count: string | number }
  >(
    `SELECT ${BUDGET_COLUMNS},
            (SELECT COALESCE(SUM(amount_centavos), 0) FROM expenses e WHERE e.budget_id = budgets.id)
              AS out_centavos,
            (SELECT COUNT(*) FROM expenses e WHERE e.budget_id = budgets.id)
              AS out_count
       FROM budgets
      WHERE id = $1 AND user_id = $2`,
    [budgetId, userId],
  );

  const row = rows[0];
  if (!row) return null;
  // Both closed states are final; neither is ever recomputed back open.
  if (row.status !== "active") return toBudget(row);

  // Transfers count here as well as expenses: the money left the budget either
  // way, so moving the last peso out closes it exactly as spending it would.
  const remaining = Number(row.amount_centavos) - Number(row.out_centavos);
  if (remaining !== 0 || Number(row.out_count) === 0) return toBudget(row);

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
    const refused = closedRefusal(locked);
    if (refused) return { ok: false as const, reason: refused };

    /*
     * A transferred allotment's amount is the transfer that funded it.
     *
     * Editing it here would create or destroy money without a matching
     * deduction anywhere: the source gave up exactly this much, and no edit on
     * this side can change what already left. Its name and dates stay editable,
     * so a mistyped label is still fixable.
     */
    if (
      locked.allocation_type === "transferred" &&
      toCentavos(input.amount) !== Number(locked.amount_centavos)
    ) {
      return { ok: false as const, reason: "transfer" as const };
    }

    await tx.query(
      /*
       * The funded figure moves with the amount, but only by what the user
       * actually put in. Raising a merged allotment adds new money; raising a
       * transferred one does not, because its funding still came from its
       * source. `LEAST` keeps the figure inside the amount when it shrinks.
       */
      `UPDATE budgets
          SET name = $3, amount_centavos = $4, start_date = $5, end_date = $6,
              funded_amount_centavos = LEAST(
                CASE WHEN allocation_type = 'transferred'
                     THEN funded_amount_centavos
                     ELSE funded_amount_centavos + ($4 - amount_centavos)
                END,
                $4
              ),
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

/**
 * Deletes a budget, unless doing so would rewrite a transfer.
 *
 * Two cases are refused beyond the fully spent one. A budget that funded
 * another allotment cannot go, because the destination's money would have no
 * origin — and the database says so too, through a RESTRICT foreign key. A
 * transferred allotment cannot go either: its money was deducted from the
 * source, so deleting it would make those pesos vanish rather than return.
 */
export async function deleteBudgetRow(
  userId: string,
  budgetId: string,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ id: string }>> {
  return withTransaction(db, async (tx) => {
    const locked = await lockBudget(tx, userId, budgetId);
    if (!locked) return { ok: false as const, reason: "not-found" as const };
    const refused = closedRefusal(locked);
    if (refused) return { ok: false as const, reason: refused };
    if (locked.allocation_type === "transferred") {
      return { ok: false as const, reason: "transfer" as const };
    }

    const { rows: absorbed } = await tx.query<{ id: string }>(
      `SELECT id FROM budgets WHERE merged_into_budget_id = $1 LIMIT 1`,
      [budgetId],
    );
    if (absorbed.length > 0) {
      // Deleting it would leave the allotments it absorbed pointing nowhere.
      return { ok: false as const, reason: "merged" as const };
    }

    const { rows: funded } = await tx.query<{ id: string }>(
      `SELECT id FROM budgets WHERE source_budget_id = $1 LIMIT 1`,
      [budgetId],
    );
    if (funded.length > 0) {
      return { ok: false as const, reason: "has-transfers" as const };
    }

    const { rows } = await tx.query<{ id: string }>(
      `DELETE FROM budgets
        WHERE id = $2 AND user_id = $1 AND status = 'active'
        RETURNING id`,
      [userId, budgetId],
    );

    if (rows[0]) return { ok: true as const, id: rows[0].id };
    return { ok: false as const, reason: "not-found" as const };
  });
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
  return closedRefusal(rows[0]) ?? "not-found";
}

/* ---------------------------------------------------------------- expenses */

export async function listExpenses(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<Expense[]> {
  const { rows } = await db.query<ExpenseRow>(
    `SELECT ${EXPENSE_SELECT} FROM expenses e
      WHERE e.user_id = $1
      ORDER BY e.expense_date DESC, e.created_at DESC, e.id`,
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
    const refused = closedRefusal(budget);
    if (refused) return { ok: false as const, reason: refused };

    const remaining = Number(budget.amount_centavos) - (await spentOn(tx, budget.id));
    if (amount > remaining) {
      return {
        ok: false as const,
        reason: "insufficient" as const,
        remaining: fromCentavos(remaining),
      };
    }

    const { rows } = await tx.query<ExpenseRow>(
      `INSERT INTO expenses (id, user_id, budget_id, name, amount_centavos, expense_date, kind)
       VALUES ($1, $2, $3, $4, $5, $6, 'expense')
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
    const { rows: current } = await tx.query<{ budget_id: string; kind: ExpenseKind }>(
      `SELECT budget_id, kind FROM expenses WHERE id = $1 AND user_id = $2`,
      [expenseId, userId],
    );
    if (!current[0]) return { ok: false as const, reason: "not-found" as const };

    /*
     * A transfer is a committed movement of money, not a line item.
     *
     * Its amount is the destination allotment's entire funding and its source
     * is where that funding came from; editing either would leave one side of
     * a two-sided transaction rewritten. Corrections belong in a new
     * transaction, not on top of this one.
     */
    if (current[0].kind === "transfer") {
      return { ok: false as const, reason: "transfer" as const };
    }

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
      const refused = closedRefusal(row);
      if (refused) return { ok: false as const, reason: refused };
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
    const { rows: current } = await tx.query<{ budget_id: string; kind: ExpenseKind }>(
      `SELECT budget_id, kind FROM expenses WHERE id = $1 AND user_id = $2`,
      [expenseId, userId],
    );
    if (!current[0]) return { ok: false as const, reason: "not-found" as const };

    // Deleting the transfer would leave the allotment it funded with money that
    // came from nowhere.
    if (current[0].kind === "transfer") {
      return { ok: false as const, reason: "transfer" as const };
    }

    const budget = await lockBudget(tx, userId, current[0].budget_id);
    if (!budget) return { ok: false as const, reason: "not-found" as const };
    const refused = closedRefusal(budget);
    if (refused) return { ok: false as const, reason: refused };

    const { rows } = await tx.query<{ id: string }>(
      `DELETE FROM expenses WHERE id = $2 AND user_id = $1 RETURNING id`,
      [userId, expenseId],
    );
    if (!rows[0]) return { ok: false as const, reason: "not-found" as const };

    await settleBudget(tx, userId, budget.id);
    return { ok: true as const, id: rows[0].id };
  });
}


/**
 * Moves money out of one allotment and into a new one.
 *
 * Both halves happen in a single transaction under the source's row lock. That
 * is what makes the operation honest: there is no instant at which the source
 * has been debited but the destination does not exist, and none at which an
 * allotment holds money nothing was deducted for. If any step throws, the
 * source's balance is exactly what it was.
 *
 * The destination is created with its own period, so from the moment it exists
 * it behaves like any other allotment — it can fund expenses, it can be spent
 * out, and it can itself be a source.
 */
export async function insertTransfer(
  userId: string,
  input: TransferInput,
  db: SqlExecutor = getDatabase(),
): Promise<
  WriteResult<{ transfer: Expense; source: Budget; destination: Budget }>
> {
  const amount = toCentavos(input.amount);

  return withTransaction(db, async (tx) => {
    const source = await lockBudget(tx, userId, input.sourceBudgetId);
    // Another account's budget is simply not found; the caller learns nothing
    // about whether it exists.
    if (!source) return { ok: false as const, reason: "not-found" as const };
    const refused = closedRefusal(source);
    if (refused) return { ok: false as const, reason: refused };

    const remaining = Number(source.amount_centavos) - (await spentOn(tx, source.id));
    if (amount > remaining) {
      return {
        ok: false as const,
        reason: "insufficient" as const,
        remaining: fromCentavos(remaining),
      };
    }

    // The deduction is recorded first, so the allotment it creates can point
    // back at the transaction that paid for it.
    const transferId = randomUUID();
    const { rows: recorded } = await tx.query<ExpenseRow>(
      `INSERT INTO expenses (id, user_id, budget_id, name, amount_centavos, expense_date, kind)
       VALUES ($1, $2, $3, $4, $5, $6, 'transfer')
       RETURNING ${EXPENSE_COLUMNS}`,
      [transferId, userId, source.id, input.name, amount, input.expenseDate],
    );

    const destinationId = randomUUID();
    const { rows: created } = await tx.query<BudgetRow>(
      // Funded at zero: this allotment's money was already counted in the
      // budget it came out of, and counting it again would invent it.
      `INSERT INTO budgets
         (id, user_id, name, amount_centavos, start_date, end_date, locked,
          allocation_type, source_budget_id, source_transaction_id,
          funded_amount_centavos)
       VALUES ($1, $2, $3, $4, $5, $6, true, 'transferred', $7, $8, 0)
       RETURNING ${BUDGET_COLUMNS}`,
      [
        destinationId,
        userId,
        input.name,
        amount,
        input.startDate,
        input.endDate,
        source.id,
        transferId,
      ],
    );

    // Moving out the last peso closes the source, exactly as spending it would.
    const settled = await settleBudget(tx, userId, source.id);
    if (!settled) return { ok: false as const, reason: "not-found" as const };

    return {
      ok: true as const,
      // The link is filled in from what was just created rather than re-read.
      transfer: { ...toExpense(recorded[0]), transferBudgetId: destinationId },
      source: settled,
      destination: toBudget(created[0]),
    };
  });
}

/* ------------------------------------------------------------------ merges */

interface MergeRow {
  merged_budget_id: string;
  merged_at: Date | string;
  source_budget_id: string;
  source_name: string;
  amount_centavos: string | number;
  expense_centavos: string | number;
  transfer_centavos: string | number;
}

function toMergeSource(row: MergeRow): BudgetMergeSource {
  const amount = fromCentavos(row.amount_centavos);
  const totalExpenses = fromCentavos(row.expense_centavos);
  const totalTransferred = fromCentavos(row.transfer_centavos);

  return {
    sourceBudgetId: row.source_budget_id,
    sourceName: row.source_name,
    amount,
    totalExpenses,
    totalTransferred,
    remaining: roundCurrency(amount - totalExpenses - totalTransferred),
  };
}

/** Groups the stored rows into one entry per merge, newest first. */
function toMerges(rows: MergeRow[]): BudgetMerge[] {
  const byBudget = new Map<string, BudgetMerge>();

  for (const row of rows) {
    const source = toMergeSource(row);
    let merge = byBudget.get(row.merged_budget_id);

    if (!merge) {
      merge = {
        mergedBudgetId: row.merged_budget_id,
        mergedAt: iso(row.merged_at),
        sources: [],
        totalAmount: 0,
        totalExpenses: 0,
        totalTransferred: 0,
        totalRemaining: 0,
      };
      byBudget.set(row.merged_budget_id, merge);
    }

    merge.sources.push(source);
    merge.totalAmount = roundCurrency(merge.totalAmount + source.amount);
    merge.totalExpenses = roundCurrency(merge.totalExpenses + source.totalExpenses);
    merge.totalTransferred = roundCurrency(
      merge.totalTransferred + source.totalTransferred,
    );
    merge.totalRemaining = roundCurrency(merge.totalRemaining + source.remaining);
  }

  return [...byBudget.values()];
}

const MERGE_COLUMNS =
  "merged_budget_id, merged_at, source_budget_id, source_name, " +
  "amount_centavos, expense_centavos, transfer_centavos";

/** Every merge this account has performed, newest first. */
export async function listBudgetMerges(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<BudgetMerge[]> {
  const { rows } = await db.query<MergeRow>(
    `SELECT ${MERGE_COLUMNS} FROM budget_merges
      WHERE user_id = $1
      ORDER BY merged_at DESC, merged_budget_id, source_name`,
    [userId],
  );
  return toMerges(rows);
}

/** Merges whose date falls inside a window, for a history report. */
export async function listBudgetMergesBetween(
  userId: string,
  from: string | null,
  to: string | null,
  db: SqlExecutor = getDatabase(),
): Promise<BudgetMerge[]> {
  const conditions = ["user_id = $1"];
  const params: unknown[] = [userId];

  // Compared as a calendar day in the same shape the rest of the app uses, so
  // a merge lands on the day the user made it.
  if (from) {
    params.push(from);
    conditions.push(`to_char(merged_at, 'YYYY-MM-DD') >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`to_char(merged_at, 'YYYY-MM-DD') <= $${params.length}`);
  }

  const { rows } = await db.query<MergeRow>(
    `SELECT ${MERGE_COLUMNS} FROM budget_merges
      WHERE ${conditions.join(" AND ")}
      ORDER BY merged_at DESC, merged_budget_id, source_name`,
    params,
  );
  return toMerges(rows);
}

/** What a source allotment held, read while its row is locked. */
interface MergeCandidate extends LockedBudget {
  name: string;
  start_date: string | null;
  end_date: string | null;
  funded_amount_centavos: string | number;
}

/**
 * The period an allotment made of two others should apply to.
 *
 * Never arbitrarily one side's. If either source carries no date restriction
 * the result carries none, because the merged allotment has to be able to fund
 * everything both could — anything narrower would silently strip dates the user
 * already had. Two dated periods become their span, which is the least
 * restrictive range this data model can express: a gap between two
 * non-contiguous periods is included rather than excluded, for the same reason.
 */
export function mergedPeriod(
  a: { start_date: string | null; end_date: string | null },
  b: { start_date: string | null; end_date: string | null },
): { startDate: string | null; endDate: string | null } {
  if (a.start_date === null || a.end_date === null) {
    return { startDate: null, endDate: null };
  }
  if (b.start_date === null || b.end_date === null) {
    return { startDate: null, endDate: null };
  }

  return {
    startDate: a.start_date < b.start_date ? a.start_date : b.start_date,
    endDate: a.end_date > b.end_date ? a.end_date : b.end_date,
  };
}

/**
 * Folds two allotments into a new one.
 *
 * The whole thing is one transaction under both sources' row locks, because a
 * half-finished merge is the one outcome that would genuinely lose money: an
 * expense whose budget no longer exists, or an allotment whose sources are
 * still open and spendable. Either everything below happens or none of it does.
 *
 * Expenses are moved, not rewritten. Only `budget_id` changes — id, amount,
 * date, name, kind and `created_at` are untouched — so the merged allotment
 * inherits both histories exactly, with nothing duplicated and nothing lost.
 * What each source held is written to `budget_merges` first, because once its
 * expenses have gone its own balance no longer describes it.
 */
export async function mergeBudgets(
  userId: string,
  input: MergeInput,
  db: SqlExecutor = getDatabase(),
): Promise<WriteResult<{ merged: Budget; sources: Budget[] }>> {
  const [firstId, secondId] = input.sourceBudgetIds;
  if (firstId === secondId) {
    return { ok: false, reason: "not-found" };
  }

  return withTransaction(db, async (tx) => {
    // Locked in id order, so two merges naming the same pair from opposite
    // directions cannot take the locks in opposite orders and deadlock.
    const ids = [firstId, secondId].sort();
    const locked: MergeCandidate[] = [];

    for (const id of ids) {
      const { rows } = await tx.query<MergeCandidate>(
        `SELECT id, name, amount_centavos, status, allocation_type,
                start_date, end_date, funded_amount_centavos
           FROM budgets
          WHERE id = $1 AND user_id = $2
            FOR UPDATE`,
        [id, userId],
      );

      const row = rows[0];
      // Another account's budget is simply absent, so a crafted request learns
      // nothing about whether it exists.
      if (!row) return { ok: false as const, reason: "not-found" as const };

      /*
       * A closed allotment cannot be merged.
       *
       * Merging moves the expenses out, which would rewrite what a fully spent
       * budget records having spent — the very thing its lock exists to
       * prevent. An already merged one is refused for the same reason, and is
       * also how a double submission is caught: the second request finds the
       * source already folded in.
       */
      const refused = closedRefusal(row);
      if (refused) return { ok: false as const, reason: refused };

      locked.push(row);
    }

    const [a, b] = locked;
    const amount = Number(a.amount_centavos) + Number(b.amount_centavos);
    // Outside money adds up; money that arrived by transfer stays uncounted, so
    // a merge can neither invent funds nor destroy them.
    const funded =
      Number(a.funded_amount_centavos) + Number(b.funded_amount_centavos);
    const period = mergedPeriod(a, b);

    const mergedId = randomUUID();
    const { rows: created } = await tx.query<BudgetRow>(
      `INSERT INTO budgets
         (id, user_id, name, amount_centavos, start_date, end_date, locked,
          funded_amount_centavos)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING ${BUDGET_COLUMNS}`,
      [mergedId, userId, input.name, amount, period.startDate, period.endDate, funded],
    );

    for (const source of locked) {
      // The snapshot is taken before the expenses move, while the source's own
      // figures still describe it.
      const { rows: totals } = await tx.query<{
        expense_centavos: string | number;
        transfer_centavos: string | number;
      }>(
        `SELECT COALESCE(SUM(amount_centavos) FILTER (WHERE kind <> 'transfer'), 0)
                  AS expense_centavos,
                COALESCE(SUM(amount_centavos) FILTER (WHERE kind = 'transfer'), 0)
                  AS transfer_centavos
           FROM expenses
          WHERE budget_id = $1`,
        [source.id],
      );

      await tx.query(
        `INSERT INTO budget_merges
           (id, user_id, merged_budget_id, source_budget_id, source_name,
            amount_centavos, expense_centavos, transfer_centavos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          userId,
          mergedId,
          source.id,
          source.name,
          Number(source.amount_centavos),
          Number(totals[0]?.expense_centavos ?? 0),
          Number(totals[0]?.transfer_centavos ?? 0),
        ],
      );

      // Only the owning budget changes. Every other column stays as recorded,
      // so no expense is duplicated, renamed, re-dated or re-priced.
      await tx.query(
        `UPDATE expenses SET budget_id = $1 WHERE budget_id = $2 AND user_id = $3`,
        [mergedId, source.id, userId],
      );

      await tx.query(
        `UPDATE budgets
            SET status = 'merged', merged_into_budget_id = $1, merged_at = now(),
                locked = true, updated_at = now()
          WHERE id = $2 AND user_id = $3`,
        [mergedId, source.id, userId],
      );
    }

    // The existing rule decides whether the result is already spent out: it is
    // closed only if the combined balance is exactly zero and something was
    // actually charged to it.
    const settled = await settleBudget(tx, userId, mergedId);
    if (!settled) return { ok: false as const, reason: "not-found" as const };

    const { rows: refreshed } = await tx.query<BudgetRow>(
      `SELECT ${BUDGET_COLUMNS} FROM budgets
        WHERE id = ANY($1) AND user_id = $2
        ORDER BY name`,
      [ids, userId],
    );

    void created;
    return {
      ok: true as const,
      merged: settled,
      sources: refreshed.map(toBudget),
    };
  });
}

/* ------------------------------------------------- aggregates and paging -- */

/**
 * One budget's outgoings, computed by the database rather than in the browser.
 *
 * Spending and transfers are counted apart because they answer different
 * questions. Both reduce the balance — the money left either way — but only
 * spending is spending, and a report that added a transfer to the expense
 * total would show a purchase that never happened.
 */
export interface BudgetTotal {
  budgetId: string;
  totalExpenses: number;
  totalTransferred: number;
  expenseCount: number;
  transferCount: number;
}

interface TotalsRow {
  budget_id: string;
  expense_centavos: string | number;
  transfer_centavos: string | number;
  expense_count: string | number;
  transfer_count: string | number;
}

/*
 * One pass, two sums.
 *
 * FILTER splits the group without a second scan of the table, so the extra
 * figure costs nothing next to the single sum this replaced.
 */
const TOTALS_COLUMNS = `budget_id,
            COALESCE(SUM(amount_centavos) FILTER (WHERE kind <> 'transfer'), 0)
              AS expense_centavos,
            COALESCE(SUM(amount_centavos) FILTER (WHERE kind = 'transfer'), 0)
              AS transfer_centavos,
            COUNT(*) FILTER (WHERE kind <> 'transfer') AS expense_count,
            COUNT(*) FILTER (WHERE kind = 'transfer') AS transfer_count`;

function toTotals(row: TotalsRow): BudgetTotal {
  return {
    budgetId: row.budget_id,
    totalExpenses: fromCentavos(row.expense_centavos),
    totalTransferred: fromCentavos(row.transfer_centavos),
    expenseCount: Number(row.expense_count),
    transferCount: Number(row.transfer_count),
  };
}

/**
 * Per-budget totals for one user.
 *
 * This is what lets the expense list be paginated. A balance is
 * `amount − SUM(everything charged)`, and summing in SQL means the client never
 * has to hold every row to know what a budget has left — one small result set
 * instead of an unbounded one.
 */
export async function budgetTotals(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<BudgetTotal[]> {
  const { rows } = await db.query<TotalsRow>(
    `SELECT ${TOTALS_COLUMNS}
       FROM expenses
      WHERE user_id = $1
      GROUP BY budget_id`,
    [userId],
  );

  return rows.map(toTotals);
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
  const { rows } = await db.query<TotalsRow>(
    `SELECT ${TOTALS_COLUMNS}
       FROM expenses
      WHERE user_id = $1 AND expense_date < $2
      GROUP BY budget_id`,
    [userId, beforeDate],
  );

  return rows.map(toTotals);
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
    `SELECT ${EXPENSE_SELECT} FROM expenses e
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
    `SELECT ${EXPENSE_SELECT} FROM expenses e
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.expense_date DESC, e.created_at DESC, e.id`,
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
