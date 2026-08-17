"use client";

import { useState } from "react";

import type { Expense } from "@/types/expense";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { EditExpenseModal } from "@/components/expenses/EditExpenseModal";
import { ExpenseItem } from "@/components/expenses/ExpenseItem";
import { formatCurrency } from "@/lib/currency";
import { formatExpenseDate } from "@/lib/utils";

export interface ExpenseListProps {
  /** Opens the add-expense flow from the empty state. */
  onAddExpense: () => void;
}

/** The expense history, newest first, with edit and delete affordances. */
export function ExpenseList({ onAddExpense }: ExpenseListProps) {
  const { expenses, totals, deleteExpense } = useTracker();
  const { showToast } = useToast();

  const [editing, setEditing] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteExpense(pendingDelete.id);
    showToast(`${pendingDelete.name} deleted`);
    setPendingDelete(null);
  };

  return (
    <section
      aria-labelledby="expenses-heading"
      className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
        <h2
          id="expenses-heading"
          className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
        >
          Expenses
        </h2>
        {expenses.length > 0 ? (
          <p className="text-[0.8125rem] text-muted">
            <span className="tabular">{formatCurrency(totals.totalExpenses)}</span>{" "}
            total
          </p>
        ) : null}
      </div>

      {expenses.length === 0 ? (
        <EmptyState onAdd={onAddExpense} />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {expenses.map((expense) => (
            <ExpenseItem
              key={expense.id}
              expense={expense}
              onEdit={setEditing}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      <EditExpenseModal
        open={editing !== null}
        expense={editing}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this expense?"
        description="This cannot be undone. Your balance will be recalculated."
        confirmLabel="Delete"
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
              {formatExpenseDate(pendingDelete.createdAt)}
            </p>
            <p className="mt-3 border-t border-border-subtle pt-3 text-[0.8125rem] text-muted">
              Balance after deleting:{" "}
              <span className="font-medium tabular text-foreground">
                {formatCurrency(totals.currentBalance + pendingDelete.amount)}
              </span>
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
