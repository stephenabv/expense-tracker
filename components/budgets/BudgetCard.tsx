"use client";

import type { BudgetSummary } from "@/types/budget";
import { Button } from "@/components/ui/Button";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { formatCurrency } from "@/lib/currency";
import { NO_DATE_LABEL, describeBudgetPeriodLong } from "@/lib/budgets";
import { cn } from "@/lib/utils";

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <rect x="4.5" y="8.5" width="11" height="7.5" rx="2" />
      {open ? (
        <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 4.9-.7" />
      ) : (
        <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 5 0v2" />
      )}
    </svg>
  );
}

export interface BudgetCardProps {
  summary: BudgetSummary;
  /** Completed periods are immutable, so their actions are presented differently. */
  immutable: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** One allotment: its terms, its own spend, and its own remaining balance. */
export function BudgetCard({
  summary,
  immutable,
  onView,
  onEdit,
  onDelete,
}: BudgetCardProps) {
  const { budget, totalExpenses, remaining, status, spentRatio, isOverspent } = summary;

  const barTone = isOverspent
    ? "bg-danger"
    : spentRatio >= 0.85
      ? "bg-warning"
      : "bg-positive";

  return (
    <article className="flex flex-col rounded-2xl border border-border-subtle bg-surface p-4 shadow-card transition-shadow duration-200 hover:shadow-raised sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] font-semibold tracking-tight text-foreground">
            {budget.name}
          </h3>
          {/* Never blank: an allotment with no dates says so in the same slot
              the dates occupy, so the missing period cannot read as missing
              data. The status badge is suppressed below when it would only
              repeat this line. */}
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            {summary.applicability === "general"
              ? NO_DATE_LABEL
              : describeBudgetPeriodLong(budget)}
          </p>
        </div>
        {status === "unrestricted" ? null : <BudgetStatusBadge status={status} />}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div className="min-w-0">
          <dt className="text-[0.75rem] text-muted">Budget</dt>
          <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular text-foreground">
            {formatCurrency(budget.amount)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.75rem] text-muted">Spent</dt>
          <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular text-foreground">
            {formatCurrency(totalExpenses)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.75rem] text-muted">Remaining</dt>
          <dd
            className={cn(
              "mt-0.5 truncate text-[0.9375rem] font-semibold tabular",
              isOverspent ? "text-danger" : "text-foreground",
            )}
          >
            {formatCurrency(remaining)}
          </dd>
        </div>
      </dl>

      <div
        className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(spentRatio * 100)}
        aria-label={`Share of ${budget.name} spent`}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barTone)}
          style={{ width: `${Math.max(spentRatio * 100, totalExpenses > 0 ? 2 : 0)}%` }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onView}>
          View
        </Button>

        {immutable ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[0.6875rem] font-medium text-muted ring-1 ring-inset ring-border-subtle">
            <LockIcon open={false} />
            Completed — locked
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-muted hover:bg-danger-soft hover:text-danger"
            >
              Delete
            </Button>
            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-muted">
              <LockIcon open={!budget.locked} />
              {budget.locked ? "Locked" : "Unlocked"}
            </span>
          </>
        )}

        <span className="ml-auto text-[0.75rem] text-muted">
          {summary.expenseCount === 1 ? "1 expense" : `${summary.expenseCount} expenses`}
        </span>
      </div>
    </article>
  );
}
