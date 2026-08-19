import { AppShell } from "@/components/layout/AppShell";
import {
  ListCardSkeleton,
  PaginationSkeleton,
  SkeletonRegion,
} from "@/components/ui/Skeleton";

/**
 * Shown while the server loads this account's budgets and expenses.
 *
 * Route-level, so it streams in place of the page rather than flashing after
 * it: a fast response never renders this at all, and a slow one shows the
 * shape of what is coming instead of an empty screen.
 */
export default function TrackerLoading() {
  return (
    <AppShell>
      <SkeletonRegion
        label="Loading your budgets and expenses…"
        className="space-y-4 pb-32 sm:space-y-5"
      >
        <ListCardSkeleton variant="budget" rows={3} />
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-card">
          <ListCardSkeleton rows={5} />
          <PaginationSkeleton />
        </div>
      </SkeletonRegion>
    </AppShell>
  );
}
