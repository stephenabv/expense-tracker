"use client";

import { useMemo } from "react";

import type { Budget } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { formatCurrency } from "@/lib/currency";
import { formatDateKey } from "@/lib/dates";
import { describeBudgetPeriodLong } from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface BudgetDetailModalProps {
  open: boolean;
  onClose: () => void;
  budget: Budget | null;
}

/** Read-only view of one allotment and the expenses charged to it. */
export function BudgetDetailModal({ open, onClose, budget }: BudgetDetailModalProps) {
  const { getBudgetSummary, expensesFor } = useTracker();

  const summary = budget ? getBudgetSummary(budget.id) : null;
  const expenses = useMemo(
    () => (budget ? expensesFor(budget.id) : []),
    [budget, expensesFor],
  );

  if (!budget || !summary) return null;

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

          {expenses.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing recorded against this allotment yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border-subtle rounded-xl border border-border-subtle">
              {expenses.map((expense) => (
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
        </div>
      </div>
    </Modal>
  );
}
