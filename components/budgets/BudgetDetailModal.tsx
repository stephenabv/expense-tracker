"use client";

import { useEffect, useState } from "react";

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { listExpensesAction } from "@/lib/server/tracker-actions";
import { ExpenseRowSkeleton } from "@/components/ui/Skeleton";
import { useTracker } from "@/components/providers/TrackerProvider";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { formatCurrency } from "@/lib/currency";
import { formatDateKey } from "@/lib/dates";
import { describeBudgetPeriodLong, isFullySpent } from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface BudgetDetailModalProps {
  open: boolean;
  onClose: () => void;
  budget: Budget | null;
}

/** Read-only view of one allotment and the expenses charged to it. */
export function BudgetDetailModal({ open, onClose, budget }: BudgetDetailModalProps) {
  const { getBudgetSummary } = useTracker();

  const summary = budget ? getBudgetSummary(budget.id) : null;

  /*
   * This budget's most recent expenses, fetched when the modal opens.
   *
   * The provider holds a page of *all* expenses, which is not the same as this
   * allotment's — so the modal asks for exactly what it shows rather than
   * filtering whatever happens to be loaded and quietly under-reporting.
   */
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !budget) return;

    let current = true;
    setLoading(true);
    setExpenses([]);

    void listExpensesAction({ budgetId: budget.id, pageSize: 10 }).then((result) => {
      if (!current) return;
      if (result.ok) setExpenses(result.data.data);
      setLoading(false);
    });

    return () => {
      current = false;
    };
  }, [open, budget]);

  if (!budget || !summary) return null;

  const closed = isFullySpent(budget);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={budget.name}
      description={describeBudgetPeriodLong(budget)}
      footer={
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <BudgetStatusBadge status={summary.status} />
          <span className="text-[0.8125rem] text-muted">
            {summary.durationDays === null
              ? "Any date"
              : summary.durationDays === 1
                ? "1 day"
                : `${summary.durationDays} days`}
          </span>
        </div>

        {/* This view is read-only for every budget; for a closed one it is
            also the only view there is, so it says why. */}
        {closed ? (
          <p className="rounded-xl border border-border-strong bg-surface-muted px-4 py-3 text-[0.8125rem] text-muted-strong">
            <span aria-hidden="true">🔒 </span>
            This allotment was spent down to {formatCurrency(0)} and is locked.
            It and the expenses below are a permanent record — they can no
            longer be edited, deleted, or added to.
          </p>
        ) : null}

        <dl className="space-y-2.5 rounded-xl border border-border-subtle bg-surface-muted p-4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-muted">Budget</dt>
            <dd className="font-semibold tabular text-foreground">
              {formatCurrency(budget.amount)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-muted">Spent</dt>
            <dd className="font-semibold tabular text-foreground">
              {formatCurrency(summary.totalExpenses)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle pt-2.5">
            <dt className="text-sm text-muted">Remaining</dt>
            <dd
              className={cn(
                "font-semibold tabular",
                summary.isOverspent ? "text-danger" : "text-foreground",
              )}
            >
              {formatCurrency(summary.remaining)}
            </dd>
          </div>
        </dl>

        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Expenses in this budget
          </h3>

          {loading ? (
            <ul className="mt-2 divide-y divide-border-subtle rounded-xl border border-border-subtle">
              {[0, 1, 2].map((index) => (
                <ExpenseRowSkeleton key={index} />
              ))}
            </ul>
          ) : expenses.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing recorded against this allotment yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border-subtle rounded-xl border border-border-subtle">
              {expenses.map((expense: Expense) => (
                <li
                  key={expense.id}
                  className="flex items-center gap-3 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] text-foreground">
                      {expense.name}
                    </p>
                    <p className="text-[0.8125rem] text-muted">
                      {formatDateKey(expense.expenseDate)}
                    </p>
                  </div>
                  <p className="shrink-0 font-medium tabular text-foreground">
                    {formatCurrency(expense.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {!loading && summary.expenseCount > expenses.length ? (
            <p className="mt-2 text-[0.8125rem] text-muted">
              Showing the {expenses.length} most recent of {summary.expenseCount}.
              See the Tracker for the full list.
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
