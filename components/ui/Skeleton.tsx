import { cn } from "@/lib/utils";

/**
 * Placeholder shapes shown while content loads.
 *
 * Two rules run through this file:
 *
 * 1. **A skeleton is the shape of the thing it replaces.** Same heights, same
 *    rhythm, same container — so the real content lands in place instead of
 *    shoving the page around when it arrives.
 * 2. **The animation stays quiet.** One slow opacity pulse, no travelling
 *    shimmer. It signals "working" without turning a loading screen into the
 *    busiest thing on the page, and opacity alone keeps it off the layout path.
 */

/** One placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-skeleton rounded-lg bg-surface-muted", className)}
    />
  );
}

/**
 * Wraps a set of placeholders and announces the wait once.
 *
 * The label is the only thing a screen reader gets: the shapes themselves are
 * hidden, because "rectangle rectangle rectangle" is not information.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A budget card: name, period, the three figures, and the spend bar. */
export function BudgetCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      <Skeleton className="mt-3.5 h-1.5 w-full rounded-full" />

      <div className="mt-4 flex items-center gap-2">
        <Skeleton className="h-9 w-16 rounded-xl" />
        <Skeleton className="h-9 w-14 rounded-xl" />
        <Skeleton className="ml-auto h-3 w-20" />
      </div>
    </div>
  );
}

/** One row of the budget list on the tracker screen. */
export function BudgetRowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <div className="shrink-0 space-y-2 text-right">
        <Skeleton className="ml-auto h-4 w-24" />
        <Skeleton className="ml-auto h-2.5 w-14" />
      </div>
    </li>
  );
}

/** One expense row: monogram, name, date, budget, amount. */
export function ExpenseRowSkeleton() {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-4 w-20 shrink-0" />
    </li>
  );
}

/** A card with a heading and a list of rows, used for both main lists. */
export function ListCardSkeleton({
  rows = 4,
  variant = "expense",
}: {
  rows?: number;
  variant?: "expense" | "budget";
}) {
  const Row = variant === "expense" ? ExpenseRowSkeleton : BudgetRowSkeleton;

  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <ul className="divide-y divide-border-subtle">
        {Array.from({ length: rows }, (_, index) => (
          <Row key={index} />
        ))}
      </ul>
    </section>
  );
}

/** The history summary card: period, totals, per-budget rows. */
export function SummaryCardSkeleton() {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-6 w-2/3" />

      <div className="mt-5 space-y-3">
        {[0, 1].map((index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border-subtle pt-4">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-10" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** One collapsed day card in the history breakdown. */
export function HistoryDaySkeleton() {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3.5 shadow-card sm:px-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-2/3" />
    </div>
  );
}

/** The pagination bar, so the list does not jump when it appears. */
export function PaginationSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <Skeleton className="h-3 w-40" />
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
    </div>
  );
}

/** A labelled field on the account screen. */
export function DetailRowSkeleton() {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}
