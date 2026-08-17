"use client";

import Link from "next/link";

import type { BudgetSummary } from "@/types/budget";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { formatCurrency } from "@/lib/currency";
import { formatDateRange } from "@/lib/dates";
import { cn } from "@/lib/utils";

const LOW_BALANCE_RATIO = 0.85;

/**
 * The hero metric: what is left in the allotment covering today.
 *
 * Remaining balance leads because that is the number the user opened the app
 * for; the budget's name and period sit above it so it is never ambiguous
 * *which* pot is being reported.
 */
export function CurrentBudgetCard({ summary }: { summary: BudgetSummary }) {
  const { budget, totalExpenses, remaining, spentRatio, isOverspent, status } = summary;
  const isLow = !isOverspent && spentRatio >= LOW_BALANCE_RATIO;

  const barTone = isOverspent ? "bg-danger" : isLow ? "bg-warning" : "bg-positive";

  return (
    <section
      aria-labelledby="current-budget-heading"
      className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-7"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium tracking-wide text-muted">
            Current Budget
          </p>
          <h2
            id="current-budget-heading"
            className="mt-1 truncate text-lg font-semibold tracking-tight text-foreground"
          >
            {budget.name}
          </h2>
          <p className="text-[0.8125rem] text-muted">
            {formatDateRange(budget.startDate, budget.endDate)}
          </p>
        </div>
        <BudgetStatusBadge status={status} />
      </div>

      <p className="mt-4 text-[0.8125rem] font-medium tracking-wide text-muted">
        Remaining
      </p>
      <p
        className={cn(
          "mt-1 text-4xl font-semibold leading-tight tracking-tight tabular [overflow-wrap:anywhere] sm:text-5xl",
          isOverspent ? "text-danger" : "text-foreground",
        )}
      >
        {formatCurrency(remaining)}
      </p>

      <div
        className="mt-5 h-2 w-full overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(spentRatio * 100)}
        aria-label="Share of this budget spent"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barTone)}
          style={{ width: `${Math.max(spentRatio * 100, totalExpenses > 0 ? 2 : 0)}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {isOverspent ? (
            <span className="text-danger">
              Over budget by {formatCurrency(Math.abs(remaining))}
            </span>
          ) : (
            <>
              <span className="tabular">{formatCurrency(totalExpenses)}</span> of{" "}
              <span className="tabular">{formatCurrency(budget.amount)}</span> spent
            </>
          )}
        </p>

        <Link
          href="/budgets"
          className="rounded-lg text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View Budget Details →
        </Link>
      </div>
    </section>
  );
}
