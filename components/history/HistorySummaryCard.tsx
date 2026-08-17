"use client";

import type { HistorySummary } from "@/types/history";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

export interface HistorySummaryCardProps {
  summary: HistorySummary;
  periodLabel: string;
}

/**
 * Aggregate figures for the selected period.
 *
 * The distinction the layout is making: expenses are a *total for the period*,
 * while budget and balances are *points in time* taken from the first and last
 * recorded days — never sums.
 */
export function HistorySummaryCard({
  summary,
  periodLabel,
}: HistorySummaryCardProps) {
  const rows: Array<{ label: string; value: string; tone?: "danger" }> = [
    { label: "Starting Budget", value: formatCurrency(summary.startingBudget) },
    { label: "Starting Balance", value: formatCurrency(summary.startingBalance) },
    { label: "Total Expenses", value: formatCurrency(summary.totalExpenses) },
    {
      label: "Ending Balance",
      value: formatCurrency(summary.endingBalance),
      tone: summary.endingBalance < 0 ? "danger" : undefined,
    },
  ];

  return (
    <section
      aria-labelledby="summary-heading"
      className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-6"
    >
      <p className="text-[0.8125rem] font-medium tracking-wide text-muted">
        Selected period
      </p>
      <h2
        id="summary-heading"
        className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
      >
        {periodLabel}
      </h2>

      <dl className="mt-5 space-y-2.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="text-sm text-muted">{row.label}</dt>
            <dd
              className={cn(
                "text-[0.9375rem] font-semibold tabular",
                row.tone === "danger" ? "text-danger" : "text-foreground",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border-subtle pt-4">
        <div>
          <dt className="text-sm text-muted">Total Expenses Count</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular text-foreground">
            {summary.expenseCount}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Active Days</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular text-foreground">
            {summary.activeDays}
          </dd>
        </div>
      </div>
    </section>
  );
}
