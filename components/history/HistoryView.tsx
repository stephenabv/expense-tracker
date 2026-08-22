"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Expense } from "@/types/expense";
import type { HistoryFilter } from "@/types/history";
import { useTracker } from "@/components/providers/TrackerProvider";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import {
  HistoryDaySkeleton,
  SkeletonRegion,
  SummaryCardSkeleton,
} from "@/components/ui/Skeleton";
import { HistoryDayCard } from "@/components/history/HistoryDayCard";
import { HistoryFilterBar } from "@/components/history/HistoryFilterBar";
import { HistorySummaryCard } from "@/components/history/HistorySummaryCard";
import { ExportPdfButton } from "@/components/history/ExportPdfButton";
import {
  buildHistory,
  describeBudgetFilter,
  describeFilter,
  filterHistory,
  summarizeHistory,
} from "@/lib/history";
import { sortBudgetsByPeriod } from "@/lib/budgets";
import { DEFAULT_PAGE_SIZE, paginationFor } from "@/lib/pagination";
import type { BudgetMerge } from "@/types/budget";
import type { HistoryMerge } from "@/types/history";
import { HistoryMergeCard } from "@/components/history/HistoryMergeCard";
import { loadHistoryAction } from "@/lib/server/tracker-actions";

/** The dates a filter covers, as the query understands them. */
function filterBounds(filter: HistoryFilter): { from: string | null; to: string | null } {
  if (filter.mode === "single") return { from: filter.date, to: filter.date };
  if (filter.mode === "range") return { from: filter.start, to: filter.end };
  return { from: null, to: null };
}

function EmptyHistory({
  label,
  filtered,
  onClear,
}: {
  label: string;
  filtered: boolean;
  onClear: () => void;
}) {
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
        {filtered ? "No activity matches your filters" : "No tracker activity yet"}
      </h3>
      <p className="mt-1 max-w-xs text-sm text-muted">
        {filtered
          ? `Nothing was recorded for ${label}. Try a wider range or a different allotment.`
          : "Record an expense on the Tracker and it will appear here."}
      </p>

      {filtered ? (
        <Button variant="secondary" className="mt-5" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The history screen.
 *
 * The server returns the expenses the filter selected — never the whole
 * account — plus what each budget had spent before the window, which is what
 * keeps a running balance true when only part of the timeline is loaded. Days
 * are then derived by the same pure functions the tests cover, and the day
 * cards are paged so a year of history is not a year of DOM.
 */
export function HistoryView() {
  const { budgets } = useTracker();
  const [filter, setFilter] = useState<HistoryFilter>({ mode: "all" });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [spentBefore, setSpentBefore] = useState<Map<string, number>>(new Map());
  const [merges, setMerges] = useState<BudgetMerge[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Only the newest request may write to state; two quick filter changes can
  // otherwise settle on the older answer.
  const requestRef = useRef(0);

  const { from, to } = filterBounds(filter);
  const budgetId = filter.budgetId ?? null;

  const load = useCallback(async () => {
    const request = (requestRef.current += 1);
    setLoading(true);

    try {
      const result = await loadHistoryAction({ from, to, budgetId });
      if (request !== requestRef.current) return;

      if (result.ok) {
        setExpenses(result.data.expenses);
        setSpentBefore(new Map(result.data.spentBefore));
        setMerges(result.data.merges);
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [from, to, budgetId]);

  useEffect(() => {
    void load();
    // A changed filter always returns to the first page: page 7 of the old
    // result set may not exist in the new one.
    setPage(1);
  }, [load]);

  const history = useMemo(
    () => buildHistory(budgets, expenses, spentBefore),
    [budgets, expenses, spentBefore],
  );

  const days = useMemo(() => filterHistory(history, filter), [history, filter]);

  /*
   * Merges that belong in this report.
   *
   * Narrowing to one allotment narrows these too: a merge is shown when the
   * chosen budget was either produced by it or folded into it, so filtering to
   * an unrelated budget does not sprinkle other budgets' merges through the
   * results.
   */
  const historyMerges = useMemo<HistoryMerge[]>(() => {
    const selected = filter.budgetId ?? null;

    return merges
      .filter(
        (merge) =>
          selected === null ||
          merge.mergedBudgetId === selected ||
          merge.sources.some((source) => source.sourceBudgetId === selected),
      )
      .map((merge) => ({
        ...merge,
        mergedBudgetName:
          budgets.find((budget) => budget.id === merge.mergedBudgetId)?.name ??
          "Merged allotment",
        date: merge.mergedAt.slice(0, 10),
      }));
  }, [merges, filter.budgetId, budgets]);
  const summary = useMemo(() => summarizeHistory(days), [days]);
  const periodLabel = useMemo(() => describeFilter(filter), [filter]);

  const selectableBudgets = useMemo(() => sortBudgetsByPeriod(budgets), [budgets]);
  const budgetLabel = useMemo(
    () => describeBudgetFilter(budgets, filter),
    [budgets, filter],
  );

  const pagination = paginationFor(days.length, page, pageSize);
  const visible = useMemo(
    () =>
      days.slice(
        (pagination.page - 1) * pagination.pageSize,
        pagination.page * pagination.pageSize,
      ),
    [days, pagination.page, pagination.pageSize],
  );

  // For "all time" the label is generic, so name the span that was found.
  const resolvedLabel =
    filter.mode === "all" && summary.firstDate && summary.lastDate
      ? describeFilter({
          mode: "range",
          start: summary.firstDate,
          end: summary.lastDate,
        })
      : periodLabel;

  const isFiltered = filter.mode !== "all" || budgetId !== null;

  return (
    <AppShell>
      <div className="space-y-4 pb-16 sm:space-y-5">
        <HistoryFilterBar
          filter={filter}
          onApply={setFilter}
          budgets={selectableBudgets}
        />

        {loading ? (
          <SkeletonRegion label="Loading your history…" className="space-y-4 sm:space-y-5">
            <SummaryCardSkeleton />
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <HistoryDaySkeleton key={index} />
              ))}
            </div>
          </SkeletonRegion>
        ) : days.length === 0 && historyMerges.length === 0 ? (
          <EmptyHistory
            label={periodLabel}
            filtered={isFiltered}
            onClear={() => setFilter({ mode: "all", budgetId: null })}
          />
        ) : (
          <>
            <HistorySummaryCard
              summary={summary}
              periodLabel={resolvedLabel}
              budgetLabel={budgetLabel}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-[0.9375rem] font-semibold tracking-tight text-foreground">
                Daily breakdown
              </h2>
              {/* The export takes every selected day, not the visible page. */}
              <ExportPdfButton
                days={days}
                summary={summary}
                merges={historyMerges}
                periodLabel={resolvedLabel}
                budgetLabel={budgetLabel}
              />
            </div>

            <div className="space-y-3">
              {/* Merges lead the breakdown rather than being interleaved with
                  the days: they are structural events, and a reader scanning
                  for spending should not have to sort them out of it. */}
              {historyMerges.map((merge) => (
                <HistoryMergeCard key={merge.mergedBudgetId} merge={merge} />
              ))}

              {visible.map((day, index) => (
                <div
                  key={`${day.date}-${day.budgetId}`}
                  className="animate-rise-in"
                  style={{
                    // A short, capped stagger: enough to read as a list
                    // settling into place, never enough to wait for.
                    animationDelay: `${Math.min(index, 6) * 25}ms`,
                  }}
                >
                  <HistoryDayCard day={day} defaultOpen={index === 0} />
                </div>
              ))}
            </div>

            <Pagination
              pagination={pagination}
              noun="days"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
