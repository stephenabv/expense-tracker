"use client";

import type { HistoryMerge } from "@/types/history";
import { formatCurrency } from "@/lib/currency";
import { formatDateKey } from "@/lib/dates";
import { MERGED_LABEL } from "@/lib/budgets";

/**
 * A merge, reported among the days but never as one of them.
 *
 * Nothing was spent and no balance moved: two allotments became one. Showing it
 * as a day card with a "daily total" would read as ₱8,000 of activity that
 * never happened, so it gets its own shape — the two sources, an arrow, and
 * what they became.
 */
export function HistoryMergeCard({ merge }: { merge: HistoryMerge }) {
  return (
    <section
      aria-label={`Budget merge on ${formatDateKey(merge.date)}`}
      className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
            {formatDateKey(merge.date)}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            Budget {MERGED_LABEL.toLowerCase()} · no money was spent
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-strong ring-1 ring-inset ring-border-strong">
          Budget Merge
        </span>
      </div>

      <div className="px-4 py-3.5 sm:px-5">
        <ul className="space-y-1.5">
          {merge.sources.map((source) => (
            <li
              key={source.sourceBudgetId}
              className="flex items-baseline justify-between gap-4 text-[0.8125rem]"
            >
              <span className="truncate text-muted-strong">{source.sourceName}</span>
              <span className="shrink-0 font-medium tabular text-foreground">
                {formatCurrency(source.amount)}
              </span>
            </li>
          ))}
        </ul>

        <p aria-hidden="true" className="mt-2 text-center text-sm text-muted">
          ↓
        </p>

        <div className="mt-2 flex items-baseline justify-between gap-4">
          <p className="truncate text-[0.9375rem] font-semibold text-foreground">
            {merge.mergedBudgetName}
          </p>
          <p className="shrink-0 font-semibold tabular text-foreground">
            {formatCurrency(merge.totalAmount)}
          </p>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border-subtle pt-3 text-[0.8125rem] sm:grid-cols-3">
          <div>
            <dt className="text-muted">Allocated</dt>
            <dd className="mt-0.5 font-medium tabular text-foreground">
              {formatCurrency(merge.totalAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Existing expenses</dt>
            <dd className="mt-0.5 font-medium tabular text-foreground">
              {formatCurrency(merge.totalExpenses)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Remaining</dt>
            <dd className="mt-0.5 font-semibold tabular text-foreground">
              {formatCurrency(merge.totalRemaining)}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
