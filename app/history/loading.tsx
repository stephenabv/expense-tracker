import { AppShell } from "@/components/layout/AppShell";
import {
  HistoryDaySkeleton,
  PaginationSkeleton,
  Skeleton,
  SkeletonRegion,
  SummaryCardSkeleton,
} from "@/components/ui/Skeleton";

/** Shown while history is assembled: filter bar, summary, day cards. */
export default function HistoryLoading() {
  return (
    <AppShell>
      <SkeletonRegion label="Loading your history…" className="space-y-4 pb-16 sm:space-y-5">
        <section className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-card sm:p-5">
          <Skeleton className="h-4 w-16" />
          <div className="mt-3 flex gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          <Skeleton className="mt-4 h-12 w-full rounded-xl" />
        </section>

        <SummaryCardSkeleton />

        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <HistoryDaySkeleton key={index} />
          ))}
        </div>

        <PaginationSkeleton />
      </SkeletonRegion>
    </AppShell>
  );
}
