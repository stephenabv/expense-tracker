"use client";

import type { HistorySummary } from "@/types/history";
import { formatCurrency } from "@/lib/currency";
import { FULLY_SPENT_LABEL, describeBudgetPeriod } from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface HistorySummaryCardProps {
  summary: HistorySummary;
  periodLabel: string;
  /** Set when the history is narrowed to a single allotment. */
  budgetLabel?: string | null;
}

/**
 * Aggregate figures for the selected period.
 *
 * Spending adds up across budgets, so a combined expense total is a real
 * number. A combined *balance* is not: each allotment is its own pot, and one
 * "remaining" figure spanning several of them is not money the user can spend.
 * The labels say "across budgets" for that reason, and per-budget balances are
 * listed separately below.
 */
export function HistorySummaryCard({
  summary,
  periodLabel,
  budgetLabel = null,
}: HistorySummaryCardProps) {
  const rows: Array<{ label: string; value: string; tone?: "danger" }> = [
    {
      label: "Total Allocated Across Budgets",
      value: formatCurrency(summary.totalAllocated),
    },
    {
      label: "Total Expenses Across Budgets",
      value: formatCurrency(summary.totalExpenses),
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

      {budgetLabel ? (
        <p className="mt-1.5 text-sm text-muted">
          Showing <span className="font-medium text-foreground">{budgetLabel}</span>{" "}
          only.
        </p>
      ) : null}

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
                  {/* The allotment's own applicability, not the span of its
                      activity — a general budget must not appear to have been
                      limited to the days it happened to be spent on. */}
                  <p className="shrink-0 text-[0.8125rem] text-muted">
                    {describeBudgetPeriod({
                      startDate: entry.budgetStartDate,
                      endDate: entry.budgetEndDate,
                    })}
                  </p>
                </div>

                {/* A closed allotment is still reported — history would
                    understate what was spent without it — but it is labelled,
                    because ₱0.00 remaining on its own does not say whether the
                    budget is finished or merely empty. On its own line, so it
                    never squeezes the name into an ellipsis. */}
                {entry.budgetStatus === "fully_spent" ? (
                  <p className="mt-0.5 text-[0.8125rem] font-medium text-muted-strong">
                    <span aria-hidden="true">🔒 </span>
                    {FULLY_SPENT_LABEL}
                  </p>
                ) : null}

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
