"use client";

import { useMemo, useState } from "react";

import type { Expense } from "@/types/expense";
import type { ExpenseSort } from "@/lib/db/tracker";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { ExpenseRowSkeleton } from "@/components/ui/Skeleton";
import { EditExpenseModal } from "@/components/expenses/EditExpenseModal";
import { ExpenseItem } from "@/components/expenses/ExpenseItem";
import { formatCurrency } from "@/lib/currency";
import { formatDateKey } from "@/lib/dates";

const SORTS: Array<{ value: ExpenseSort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "highest", label: "Highest amount" },
  { value: "lowest", label: "Lowest amount" },
];

export interface ExpenseListProps {
  /** Opens the add-expense flow from the empty state. */
  onAddExpense: () => void;
  onCreateBudget?: (date: string) => void;
}

/**
 * The expense list: one page at a time.
 *
 * Sorting and filtering are query parameters, not array operations — "highest
 * amount" means the highest of everything recorded, not the highest of the
 * twenty rows that happen to be loaded. The three states are kept distinct: a
 * skeleton while a page is in flight, an empty state when the account has
 * nothing, and a different message when a filter simply matched nothing.
 */
export function ExpenseList({ onAddExpense, onCreateBudget }: ExpenseListProps) {
  const {
    expenses,
    expensePagination,
    expenseQuery,
    expensesLoading,
    setExpenseQuery,
    budgets,
    deleteExpense,
  } = useTracker();
  const { showToast } = useToast();

  const [editing, setEditing] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  const budgetNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const budget of budgets) map.set(budget.id, budget.name);
    return map;
  }, [budgets]);

  const filtered = expenseQuery.budgetId !== null;
  const isEmpty = expensePagination.totalItems === 0;

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);

    const removed = await deleteExpense(pendingDelete.id);
    setDeleting(false);
    if (!removed) return;

    showToast(`${pendingDelete.name} deleted`);
    setPendingDelete(null);
  };

  return (
    <section
      aria-labelledby="expenses-heading"
      className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3.5 sm:px-5">
        <h2
          id="expenses-heading"
          className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
        >
          Expenses
        </h2>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The count lives in the pagination bar below; repeating it here
              just gave the same sentence twice on one screen. */}
          {!isEmpty || filtered ? (
            <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted">
              <span className="sr-only sm:not-sr-only">Sort</span>
              <select
                aria-label="Sort expenses"
                value={expenseQuery.sort}
                disabled={expensesLoading}
                onChange={(event) =>
                  setExpenseQuery({ sort: event.target.value as ExpenseSort })
                }
                className="h-9 rounded-lg border border-border-subtle bg-surface px-2 text-sm text-foreground transition-colors duration-150 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {/* Filtering by budget is offered only once there is more than one. */}
      {budgets.length > 1 ? (
        <div className="border-b border-border-subtle px-4 py-2.5 sm:px-5">
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <span className="whitespace-nowrap">Budget</span>
            <select
              aria-label="Show expenses from"
              value={expenseQuery.budgetId ?? ""}
              disabled={expensesLoading}
              onChange={(event) =>
                setExpenseQuery({ budgetId: event.target.value || null })
              }
              className="h-9 min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-2 text-sm text-foreground transition-colors duration-150 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="">All allotments</option>
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {expensesLoading ? (
        <ul aria-busy="true" className="divide-y divide-border-subtle">
          {Array.from({ length: Math.min(expenses.length || 4, 6) }, (_, index) => (
            <ExpenseRowSkeleton key={index} />
          ))}
        </ul>
      ) : isEmpty ? (
        filtered ? (
          // A filter matching nothing is not the same as having nothing, and
          // offering "add your first expense" here would be the wrong answer.
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <h3 className="text-base font-semibold text-foreground">
              No expenses match this filter
            </h3>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Nothing was recorded against this allotment yet.
            </p>
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => setExpenseQuery({ budgetId: null })}
            >
              Clear filter
            </Button>
          </div>
        ) : (
          <EmptyState onAdd={onAddExpense} />
        )
      ) : (
        <ul className="divide-y divide-border-subtle">
          {expenses.map((expense) => (
            <ExpenseItem
              key={expense.id}
              expense={expense}
              budgetName={budgetNames.get(expense.budgetId)}
              onEdit={setEditing}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      {!isEmpty ? (
        <div className="border-t border-border-subtle px-4 py-3 sm:px-5">
          <Pagination
            pagination={expensePagination}
            busy={expensesLoading}
            onPageChange={(page) => setExpenseQuery({ page })}
            onPageSizeChange={(pageSize) => setExpenseQuery({ pageSize })}
          />
        </div>
      ) : null}

      <EditExpenseModal
        open={editing !== null}
        expense={editing}
        onClose={() => setEditing(null)}
        onCreateBudget={onCreateBudget}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this expense?"
        description="This cannot be undone. Its budget's balance will be recalculated."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Keep it"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      >
        {pendingDelete ? (
          <div className="rounded-xl border border-border-subtle bg-surface-muted p-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="truncate text-[0.9375rem] font-medium text-foreground">
                {pendingDelete.name}
              </p>
              <p className="shrink-0 font-semibold tabular text-foreground">
                {formatCurrency(pendingDelete.amount)}
              </p>
            </div>
            <p className="mt-1 text-[0.8125rem] text-muted">
              {formatDateKey(pendingDelete.expenseDate)}
              {budgetNames.has(pendingDelete.budgetId)
                ? ` · ${budgetNames.get(pendingDelete.budgetId)}`
                : ""}
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
