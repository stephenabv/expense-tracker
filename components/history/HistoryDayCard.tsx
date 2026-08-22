"use client";

import { useState } from "react";

import type { HistoryDay } from "@/types/history";
import { formatCurrency } from "@/lib/currency";
import { formatDateKey } from "@/lib/dates";
import { TRANSFER_ROW_LABEL } from "@/lib/budgets";
import { cn } from "@/lib/utils";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "h-4 w-4 shrink-0 text-muted transition-transform duration-200",
        open && "rotate-180",
      )}
    >
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

export interface HistoryDayCardProps {
  day: HistoryDay;
  /** Expanded by default for the newest day so the page opens with content. */
  defaultOpen?: boolean;
}

/** One day within one budget, collapsible. */
export function HistoryDayCard({ day, defaultOpen = false }: HistoryDayCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `day-${day.date}-${day.budgetId}`;

  const countLabel =
    day.expenses.length === 1 ? "1 transaction" : `${day.expenses.length} transactions`;

  /*
   * The header quotes everything that left the budget that day.
   *
   * "Daily Total" below is broken back out into spending and transfers, but the
   * collapsed row has to reconcile with the closing balance — showing only the
   * expenses would leave the arithmetic looking wrong.
   */
  const dayTotal = day.totalExpenses + day.totalTransferred;

  return (
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
              {formatDateKey(day.date)}
            </p>
            {/* The budget is named on every row: with several allotments in
                range, the date alone does not say which pot was spent. */}
            <p className="mt-0.5 truncate text-[0.8125rem] text-muted">
              <span className="text-muted-strong">{day.budgetName}</span> ·{" "}
              {countLabel} ·{" "}
              <span className="tabular">{formatCurrency(dayTotal)}</span>
            </p>
          </div>
          <ChevronIcon open={open} />
        </button>
      </h3>

      {open ? (
        <div id={panelId} className="animate-rise-in border-t border-border-subtle">
          <ul className="divide-y divide-border-subtle">
            {day.expenses.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] text-foreground">
                    {expense.name}
                  </p>
                  {/* A transfer says what it is. Without the line it would read
                      as a ₱2,000 purchase named after the new allotment. */}
                  {expense.kind === "transfer" ? (
                    <p className="truncate text-[0.75rem] font-medium text-muted">
                      {TRANSFER_ROW_LABEL}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-[0.9375rem] font-medium tabular text-foreground">
                  {formatCurrency(expense.amount)}
                </p>
              </li>
            ))}
          </ul>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border-subtle bg-surface-muted px-4 py-3.5 text-[0.8125rem] sm:grid-cols-4 sm:px-5">
            <div>
              <dt className="text-muted">Budget</dt>
              <dd className="mt-0.5 font-medium tabular text-foreground">
                {formatCurrency(day.budgetAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Opening</dt>
              <dd className="mt-0.5 font-medium tabular text-foreground">
                {formatCurrency(day.startingBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">
                {day.totalTransferred > 0 ? "Spent" : "Daily Total"}
              </dt>
              <dd className="mt-0.5 font-medium tabular text-foreground">
                {formatCurrency(day.totalExpenses)}
              </dd>
            </div>
            {day.totalTransferred > 0 ? (
              <div>
                <dt className="text-muted">Transferred</dt>
                <dd className="mt-0.5 font-medium tabular text-foreground">
                  {formatCurrency(day.totalTransferred)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">Closing</dt>
              <dd
                className={cn(
                  "mt-0.5 font-semibold tabular",
                  day.endingBalance < 0 ? "text-danger" : "text-foreground",
                )}
              >
                {formatCurrency(day.endingBalance)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
