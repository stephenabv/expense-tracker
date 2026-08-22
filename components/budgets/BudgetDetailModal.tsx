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
import {
  ALLOCATION_LABELS,
  budgetsFundedBy,
  budgetsMergedInto,
  describeBudgetPeriodLong,
  isFullySpent,
  isMerged,
  isTransferred,
  mergedIntoBudget,
  sourceBudgetOf,
} from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface BudgetDetailModalProps {
  open: boolean;
  onClose: () => void;
  budget: Budget | null;
}

/** Read-only view of one allotment and the expenses charged to it. */
export function BudgetDetailModal({ open, onClose, budget }: BudgetDetailModalProps) {
  const { getBudgetSummary, budgets, merges } = useTracker();

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
  const merged = isMerged(budget);
  const source = sourceBudgetOf(budgets, budget);
  const funded = budgetsFundedBy(budgets, budget.id);
  const mergedInto = mergedIntoBudget(budgets, budget);
  const absorbed = budgetsMergedInto(budgets, budget.id);

  /*
   * A merged allotment's own figures no longer describe it — its expenses moved
   * to the budget it became part of — so its snapshot is read instead.
   */
  const snapshot = merges
    .flatMap((merge) => merge.sources)
    .find((entry) => entry.sourceBudgetId === budget.id);

  /** For the allotment a merge produced: what went into it. */
  const madeFrom = merges.find((merge) => merge.mergedBudgetId === budget.id);

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

        {merged ? (
          <p className="rounded-xl border border-border-strong bg-surface-muted px-4 py-3 text-[0.8125rem] text-muted-strong">
            <span aria-hidden="true">⇢ </span>
            This allotment was merged into{" "}
            <span className="font-medium text-foreground">
              {mergedInto?.name ?? "another allotment"}
            </span>
            . Its expenses moved there in full and are listed under that budget;
            the figures below are what it held at the time.
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
              {formatCurrency(snapshot?.totalExpenses ?? summary.totalExpenses)}
            </dd>
          </div>
          {/* Money moved out is reported on its own line, never folded into
              "Spent": the user did not buy anything with it. */}
          {(snapshot?.totalTransferred ?? summary.totalTransferred) > 0 ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Transferred out</dt>
              <dd className="font-semibold tabular text-foreground">
                {formatCurrency(snapshot?.totalTransferred ?? summary.totalTransferred)}
              </dd>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle pt-2.5">
            <dt className="text-sm text-muted">Remaining</dt>
            <dd
              className={cn(
                "font-semibold tabular",
                summary.isOverspent ? "text-danger" : "text-foreground",
              )}
            >
              {formatCurrency(snapshot?.remaining ?? summary.remaining)}
            </dd>
          </div>
        </dl>

        {/* Where this allotment's money came from. Traceable in both
            directions: a destination names its source, and a source lists what
            it funded. */}
        {isTransferred(budget) ? (
          <dl className="space-y-2.5 rounded-xl border border-border-subtle p-4">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Allocation Type</dt>
              <dd className="text-sm font-medium text-foreground">
                {ALLOCATION_LABELS[budget.allocationType]}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Source</dt>
              <dd className="truncate text-sm font-medium text-foreground">
                {source?.name ?? "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Transferred Amount</dt>
              <dd className="font-semibold tabular text-foreground">
                {formatCurrency(budget.amount)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Created</dt>
              <dd className="text-sm font-medium text-foreground">
                {formatDateKey(budget.createdAt.slice(0, 10))}
              </dd>
            </div>
          </dl>
        ) : null}

        {/* Both directions of the merge, so the lineage can be followed either
            way: what this became, or what it was made of. */}
        {merged && mergedInto ? (
          <dl className="space-y-2.5 rounded-xl border border-border-subtle p-4">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-muted">Merged into</dt>
              <dd className="truncate text-sm font-medium text-foreground">
                {mergedInto.name}
              </dd>
            </div>
            {budget.mergedAt ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-muted">Merged</dt>
                <dd className="text-sm font-medium text-foreground">
                  {formatDateKey(budget.mergedAt.slice(0, 10))}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {madeFrom ? (
          <div className="rounded-xl border border-border-subtle p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Merged from
            </h3>
            <ul className="mt-2 space-y-1.5">
              {madeFrom.sources.map((entry) => (
                <li
                  key={entry.sourceBudgetId}
                  className="flex items-baseline justify-between gap-4 text-[0.8125rem]"
                >
                  <span className="truncate text-muted-strong">
                    {entry.sourceName}
                  </span>
                  <span className="shrink-0 font-medium tabular text-foreground">
                    {formatCurrency(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.8125rem] text-muted">
              Merged {formatDateKey(madeFrom.mergedAt.slice(0, 10))}. Their
              expenses came with them, unchanged.
            </p>
          </div>
        ) : null}

        {absorbed.length > 0 && !madeFrom ? (
          <div className="rounded-xl border border-border-subtle p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Allotments merged into this one
            </h3>
            <ul className="mt-2 space-y-1.5">
              {absorbed.map((entry) => (
                <li key={entry.id} className="truncate text-[0.8125rem] text-muted-strong">
                  {entry.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {funded.length > 0 ? (
          <div className="rounded-xl border border-border-subtle p-4">
            <h3 className="text-sm font-semibold text-foreground">
              Allotments funded from this budget
            </h3>
            <ul className="mt-2 space-y-1.5">
              {funded.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-4 text-[0.8125rem]"
                >
                  <span className="truncate text-muted-strong">{entry.name}</span>
                  <span className="shrink-0 font-medium tabular text-foreground">
                    {formatCurrency(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Transactions in this budget
          </h3>

          {loading ? (
            <ul className="mt-2 divide-y divide-border-subtle rounded-xl border border-border-subtle">
              {[0, 1, 2].map((index) => (
                <ExpenseRowSkeleton key={index} />
              ))}
            </ul>
          ) : expenses.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {merged
                ? `Its expenses moved to ${mergedInto?.name ?? "the merged allotment"} and are listed there.`
                : "Nothing recorded against this allotment yet."}
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
