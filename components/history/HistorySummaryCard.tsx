"use client";

import type { HistorySummary } from "@/types/history";
import { formatCurrency } from "@/lib/currency";
import { formatDateRange } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface HistorySummaryCardProps {
  summary: HistorySummary;
  periodLabel: string;
}

/**
 * Aggregate figures for the selected period.
 *
 * Budgets are independent pots, so allotments and remaining balances are added
 * across budgets. Within a budget they are point-in-time values and are never
 * summed across days — the per-budget rows below show each one separately.
 */
export function HistorySummaryCard({ summary, periodLabel }: HistorySummaryCardProps) {
  const rows: Array<{ label: string; value: string; tone?: "danger" }> = [
    { label: "Total Allocated", value: formatCurrency(summary.totalAllocated) },
    { label: "Total Expenses", value: formatCurrency(summary.totalExpenses) },
    {
      label: "Total Remaining",
      value: formatCurrency(summary.totalRemaining),
      tone: summary.totalRemaining < 0 ? "danger" : undefined,
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
          <div key={row.label} className="flex items-baseline justify-between gap-4">
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

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border-subtle pt-4">
        <div>
          <dt className="text-[0.8125rem] text-muted">Budgets</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular text-foreground">
            {summary.budgetCount}
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted">Expenses</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular text-foreground">
            {summary.expenseCount}
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted">Active Days</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular text-foreground">
            {summary.activeDays}
          </dd>
        </div>
      </div>

      {summary.budgets.length > 0 ? (
        <div className="mt-5 border-t border-border-subtle pt-4">
          <h3 className="text-sm font-semibold text-foreground">By budget</h3>

          <ul className="mt-3 space-y-3">
            {summary.budgets.map((entry) => (
              <li key={entry.budgetId}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[0.9375rem] font-medium text-foreground">
                    {entry.budgetName}
                  </p>
                  <p className="shrink-0 text-[0.8125rem] text-muted">
                    {formatDateRange(entry.firstDate, entry.lastDate)}
                  </p>
                </div>

                <dl className="mt-1 grid grid-cols-3 gap-2 text-[0.8125rem]">
                  <div>
                    <dt className="text-muted">Budget</dt>
                    <dd className="font-medium tabular text-foreground">
                      {formatCurrency(entry.budgetAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Spent</dt>
                    <dd className="font-medium tabular text-foreground">
                      {formatCurrency(entry.totalExpenses)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Remaining</dt>
                    <dd
                      className={cn(
                        "font-semibold tabular",
                        entry.remaining < 0 ? "text-danger" : "text-foreground",
                      )}
                    >
                      {formatCurrency(entry.remaining)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
