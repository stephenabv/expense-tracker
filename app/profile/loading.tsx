import { AppShell } from "@/components/layout/AppShell";
import { DetailRowSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/** Shown while the account record is read. */
export default function ProfileLoading() {
  return (
    <AppShell>
      <SkeletonRegion label="Loading your account…" className="pb-16">
        <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-card sm:p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-3 w-64" />

          <div className="mt-5 divide-y divide-border-subtle border-t border-border-subtle">
            {[0, 1, 2, 3, 4].map((index) => (
              <DetailRowSkeleton key={index} />
            ))}
          </div>

          <Skeleton className="mt-6 h-11 w-32 rounded-xl" />
        </section>
      </SkeletonRegion>
    </AppShell>
  );
}
