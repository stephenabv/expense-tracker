/** Placeholder shown while persisted state is read, matching the real layout. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite" className="pb-32">
      <span className="sr-only">Loading your expenses…</span>

      <div className="mb-5 h-7 w-44 animate-pulse rounded-lg bg-surface-muted sm:mb-6" />

      <div className="space-y-4 sm:space-y-5">
        <div className="h-44 animate-pulse rounded-2xl border border-border-subtle bg-surface" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-2xl border border-border-subtle bg-surface"
            />
          ))}
        </div>

        <div className="h-56 animate-pulse rounded-2xl border border-border-subtle bg-surface" />
      </div>
    </div>
  );
}
