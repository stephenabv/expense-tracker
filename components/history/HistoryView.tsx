"use client";

import { useMemo, useState } from "react";

import type { HistoryFilter } from "@/types/history";
import { useTracker } from "@/components/providers/TrackerProvider";
import { AppShell } from "@/components/layout/AppShell";
import { HistoryDayCard } from "@/components/history/HistoryDayCard";
import { HistoryFilterBar } from "@/components/history/HistoryFilterBar";
import { HistorySummaryCard } from "@/components/history/HistorySummaryCard";
import { ExportPdfButton } from "@/components/history/ExportPdfButton";
import { buildHistory, describeFilter, filterHistory, summarizeHistory } from "@/lib/history";

function HistorySkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4 pb-16 sm:space-y-5">
      <span className="sr-only">Loading your history…</span>
      <div className="h-44 animate-pulse rounded-2xl border border-border-subtle bg-surface" />
      <div className="h-56 animate-pulse rounded-2xl border border-border-subtle bg-surface" />
    </div>
  );
}

function EmptyHistory({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-border-subtle bg-surface px-6 py-14 text-center shadow-card">
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted ring-1 ring-inset ring-border-subtle"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-muted"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      </div>

      <h3 className="mt-4 text-base font-semibold text-foreground">
        No tracker activity found
      </h3>
      <p className="mt-1 max-w-xs text-sm text-muted">
        Nothing was recorded for {label}. Try a wider range, or record an
        expense on the Tracker.
      </p>
    </div>
  );
}

/**
 * The history screen.
 *
 * Each day is reported against the budget that paid for it, with balances
 * chained inside that budget only — so two allotments running back to back read
 * as two separate financial periods rather than one continuous account.
 */
export function HistoryView() {
  const { hydrated, budgets, expenses } = useTracker();
  const [filter, setFilter] = useState<HistoryFilter>({ mode: "all" });

  // Derived from source data, so a back-dated expense or a corrected budget
  // shows up here immediately rather than behind a stale snapshot.
  const history = useMemo(
    () => buildHistory(budgets, expenses),
    [budgets, expenses],
  );

  const days = useMemo(() => filterHistory(history, filter), [history, filter]);
  const summary = useMemo(() => summarizeHistory(days), [days]);
  const periodLabel = useMemo(() => describeFilter(filter), [filter]);

  // For "all time" the label is generic, so name the span that was actually found.
  const resolvedLabel =
    filter.mode === "all" && summary.firstDate && summary.lastDate
      ? describeFilter({
          mode: "range",
          start: summary.firstDate,
          end: summary.lastDate,
        })
      : periodLabel;

  if (!hydrated) {
    return (
      <AppShell>
        <HistorySkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 pb-16 sm:space-y-5">
        <HistoryFilterBar filter={filter} onApply={setFilter} />

        {days.length === 0 ? (
          <EmptyHistory label={periodLabel} />
        ) : (
          <>
            <HistorySummaryCard summary={summary} periodLabel={resolvedLabel} />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
                Daily breakdown
              </h2>
              <ExportPdfButton
                days={days}
                summary={summary}
                periodLabel={resolvedLabel}
              />
            </div>

            <div className="space-y-3">
              {days.map((day, index) => (
                <HistoryDayCard
                  key={`${day.date}-${day.budgetId}`}
                  day={day}
                  defaultOpen={index === 0}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
