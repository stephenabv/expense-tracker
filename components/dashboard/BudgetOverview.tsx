"use client";

import Link from "next/link";

import type { Budget, BudgetSummary } from "@/types/budget";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { formatCurrency } from "@/lib/currency";
import { FULLY_SPENT_LABEL, describeBudgetPeriod } from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface BudgetOverviewProps {
  summaries: BudgetSummary[];
  /** Ids of the allotments that can fund an expense dated today. */
  availableIds?: Set<string>;
  /** Opens one allotment's detail. */
  onSelect?: (budget: Budget) => void;
  /** Section heading. Defaults to the open-allotments list. */
  title?: string;
  /** Unique id for the heading, so two lists can sit on one page. */
  headingId?: string;
  /** One line under the heading, e.g. what makes this list different. */
  description?: string;
  /** Hides the link to the budgets screen. */
  hideManageLink?: boolean;
}

/**
 * Every allotment and what each has left.
 *
 * The balances are listed side by side and never summed: they are separate
 * pots, and one total would suggest a single spendable figure that does not
 * exist.
 */
export function BudgetOverview({
  summaries,
  availableIds,
  onSelect,
  title = "Your Budgets",
  headingId = "your-budgets-heading",
  description,
  hideManageLink = false,
}: BudgetOverviewProps) {
  if (summaries.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-[0.9375rem] font-semibold tracking-tight text-foreground"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p>
          ) : null}
        </div>
        {hideManageLink ? null : (
          <Link
            href="/budgets"
            className="shrink-0 rounded-lg text-[0.8125rem] font-medium text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Manage
          </Link>
        )}
      </div>

      <ul className="divide-y divide-border-subtle">
        {summaries.map((summary) => {
          const available = availableIds?.has(summary.budget.id) ?? false;

          const row = (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="min-w-0 truncate text-[0.9375rem] font-medium text-foreground">
                    {summary.budget.name}
                  </p>
                  {available ? (
                    <span className="shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-background">
                      Available
                    </span>
                  ) : null}
                  {/* The status badge on the right is hidden on a phone, where
                      the row has no width for it — but "₱0.00 remaining" alone
                      does not say the budget is closed, so the state rides next
                      to the name at every size. */}
                  {summary.status === "fully-spent" ? (
                    <span className="shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-background sm:hidden">
                      🔒 {FULLY_SPENT_LABEL}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[0.8125rem] text-muted">
                  {describeBudgetPeriod(summary.budget)}
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
                <p className="text-[0.75rem] text-muted">remaining</p>
              </div>

              <span className="hidden shrink-0 sm:block">
                <BudgetStatusBadge status={summary.status} />
              </span>
            </>
          );

          return (
            <li key={summary.budget.id}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(summary.budget)}
                  aria-label={`View ${summary.budget.name}`}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
