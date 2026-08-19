"use client";

import type { BudgetStatus } from "@/types/budget";
import { STATUS_LABELS } from "@/lib/budgets";
import { cn } from "@/lib/utils";

const TONES: Record<BudgetStatus, string> = {
  active: "bg-positive-soft text-positive",
  upcoming: "bg-surface-muted text-muted-strong ring-1 ring-inset ring-border-subtle",
  completed: "bg-surface-muted text-muted ring-1 ring-inset ring-border-subtle",
  "over-budget": "bg-danger-soft text-danger",
  unrestricted:
    "bg-surface-muted text-muted-strong ring-1 ring-inset ring-border-subtle",
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
      {STATUS_LABELS[status]}
    </span>
  );
}
