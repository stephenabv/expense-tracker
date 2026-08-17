"use client";

import Link from "next/link";

import type { BudgetSummary } from "@/types/budget";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { formatCurrency } from "@/lib/currency";
import { formatShortDateRange } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** At-a-glance list of every allotment and what each has left. */
export function BudgetOverview({
  summaries,
  currentBudgetId,
}: {
  summaries: BudgetSummary[];
  currentBudgetId?: string;
}) {
  if (summaries.length === 0) return null;

  return (
    <section
      aria-labelledby="your-budgets-heading"
      className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
        <h2
          id="your-budgets-heading"
          className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
        >
          Your Budgets
        </h2>
        <Link
          href="/budgets"
          className="rounded-lg text-[0.8125rem] font-medium text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Manage
        </Link>
      </div>

      <ul className="divide-y divide-border-subtle">
        {summaries.map((summary) => (
          <li
            key={summary.budget.id}
            className="flex items-center gap-3 px-4 py-3 sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-[0.9375rem] font-medium text-foreground">
                <span className="truncate">{summary.budget.name}</span>
                {summary.budget.id === currentBudgetId ? (
                  <span className="shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-background">
                    Now
                  </span>
                ) : null}
              </p>
              <p className="truncate text-[0.8125rem] text-muted">
                {formatShortDateRange(summary.budget.startDate, summary.budget.endDate)}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p
                className={cn(
                  "text-[0.9375rem] font-semibold tabular",
                  summary.isOverspent ? "text-danger" : "text-foreground",
                )}
              >
                {formatCurrency(summary.remaining)}
              </p>
              <p className="text-[0.75rem] text-muted">left</p>
            </div>

            <BudgetStatusBadge status={summary.status} className="hidden sm:inline-flex" />
          </li>
        ))}
      </ul>
    </section>
  );
}
