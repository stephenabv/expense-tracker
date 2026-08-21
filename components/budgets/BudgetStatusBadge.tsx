"use client";

import type { BudgetStatus } from "@/types/budget";
import { STATUS_LABELS } from "@/lib/budgets";
import { cn } from "@/lib/utils";

const TONES: Record<BudgetStatus, string> = {
  active: "bg-positive-soft text-positive",
  upcoming: "bg-surface-muted text-muted-strong ring-1 ring-inset ring-border-subtle",
  "period-ended": "bg-surface-muted text-muted ring-1 ring-inset ring-border-subtle",
  "over-budget": "bg-danger-soft text-danger",
  unrestricted:
    "bg-surface-muted text-muted-strong ring-1 ring-inset ring-border-subtle",
  // Closed, not failed: a budget spent exactly to zero did what it was for, so
  // it reads as settled rather than as a warning.
  "fully-spent": "bg-foreground text-background",
};

/** Compact status pill shared by every budget surface. */
export function BudgetStatusBadge({
  status,
  className,
}: {
  status: BudgetStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium",
        TONES[status],
        className,
      )}
    >
      {status === "fully-spent" ? <span aria-hidden="true" className="mr-1">🔒</span> : null}
      {STATUS_LABELS[status]}
    </span>
  );
}
