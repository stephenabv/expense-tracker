import { AppShell } from "@/components/layout/AppShell";
import { BudgetCardSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/** Shown while this account's allotments are read. */
export default function BudgetsLoading() {
  return (
    <AppShell>
      <SkeletonRegion label="Loading your budgets…" className="space-y-4 pb-16 sm:space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <BudgetCardSkeleton key={index} />
          ))}
        </div>
      </SkeletonRegion>
    </AppShell>
  );
}
