"use client";

import { Button } from "@/components/ui/Button";

export interface EmptyStateProps {
  onAdd: () => void;
}

/** Shown when nothing has been recorded yet — points straight at the next step. */
export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center sm:py-16">
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
          <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z" />
          <path d="M4 10h16M8 14h4" />
        </svg>
      </div>

      <h3 className="mt-4 text-base font-semibold text-foreground">
        No expenses yet
      </h3>
      <p className="mt-1 max-w-[15rem] text-sm text-muted">
        Start tracking your spending by adding your first expense.
      </p>

      <Button onClick={onAdd} className="mt-5">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="h-4 w-4"
        >
          <path d="M10 4.5v11M4.5 10h11" />
        </svg>
        Add your first expense
      </Button>
    </div>
  );
}
