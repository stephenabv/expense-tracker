"use client";

import { useTracker } from "@/components/providers/TrackerProvider";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/** Threshold at which the remaining balance is flagged as running low. */
const LOW_BALANCE_RATIO = 0.85;

/**
 * The hero metric.
 *
 * Current balance is the number the user is looking for, so it gets the largest
 * type on the page plus a meter that shows how much of the budget is gone.
 */
export function BalanceCard() {
  const { totals, budget } = useTracker();
  const { currentBalance, totalExpenses, spentRatio, isOverspent } = totals;

  const budgetConfigured = budget !== null;
  const isLow = !isOverspent && spentRatio >= LOW_BALANCE_RATIO;

  const tone = isOverspent ? "danger" : isLow ? "warning" : "positive";

  const toneClasses = {
    positive: { text: "text-positive", bar: "bg-positive" },
    warning: { text: "text-warning", bar: "bg-warning" },
    danger: { text: "text-danger", bar: "bg-danger" },
  }[tone];

  return (
    <section
      aria-labelledby="balance-heading"
      className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-7"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="balance-heading"
          className="text-[0.8125rem] font-medium tracking-wide text-muted"
        >
          Current Balance
        </h2>

        {budgetConfigured ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              isOverspent
                ? "bg-danger-soft text-danger"
                : isLow
                  ? "bg-warning-soft text-warning"
                  : "bg-positive-soft text-positive",
            )}
          >
            {isOverspent ? "Over budget" : isLow ? "Running low" : "On track"}
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          "mt-2 text-4xl font-semibold leading-tight tracking-tight tabular [overflow-wrap:anywhere] sm:text-5xl",
          isOverspent ? "text-danger" : "text-foreground",
        )}
      >
        {formatCurrency(currentBalance)}
      </p>

      {budgetConfigured ? (
        <>
          <div
            className="mt-5 h-2 w-full overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border-subtle"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spentRatio * 100)}
            aria-label="Share of budget spent"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-out",
                toneClasses.bar,
              )}
              style={{ width: `${Math.max(spentRatio * 100, totalExpenses > 0 ? 2 : 0)}%` }}
            />
          </div>

          <p className="mt-3 text-sm text-muted">
            {isOverspent ? (
              <span className={toneClasses.text}>
                Over budget by {formatCurrency(Math.abs(currentBalance))}
              </span>
            ) : (
              <>
                <span className="tabular">{formatCurrency(totalExpenses)}</span>{" "}
                of <span className="tabular">{formatCurrency(totals.budget)}</span>{" "}
                spent
              </>
            )}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Set a budget allotment to start tracking your balance.
        </p>
      )}
    </section>
  );
}
