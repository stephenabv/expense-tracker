"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Secondary line beneath the value. */
  caption?: ReactNode;
  /** Rendered top-right, e.g. the budget lock control. */
  action?: ReactNode;
  className?: string;
}

/** The shared surface used by every dashboard metric. */
export function StatCard({
  label,
  value,
  caption,
  action,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-border-subtle bg-surface p-4 shadow-card sm:p-5",
        "transition-shadow duration-200 hover:shadow-raised",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-medium tracking-wide text-muted">
          {label}
        </p>
        {action}
      </div>

      {/* `anywhere` lets extreme amounts wrap instead of spilling out of the card. */}
      <div className="mt-2 text-xl font-semibold leading-snug tracking-tight text-foreground tabular [overflow-wrap:anywhere] sm:text-2xl">
        {value}
      </div>

      {caption ? (
        <div className="mt-1.5 text-[0.8125rem] text-muted">{caption}</div>
      ) : null}
    </div>
  );
}
