"use client";

import { Button } from "@/components/ui/Button";
import { MERGED_LABEL } from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface MergedSourcesToggleProps {
  /** How many allotments were folded into this one. */
  count: number;
  expanded: boolean;
  onToggle: () => void;
  /** Id of the panel this control reveals, for assistive technology. */
  controls: string;
  /** The budget the sources were folded into, named for screen readers. */
  budgetName: string;
  disabled?: boolean;
}

/**
 * The one control that reveals a budget's merge record.
 *
 * Used by a budget card and by a nested source row alike, so a chain of merges
 * expands the same way at every level instead of inventing a new affordance
 * one step down.
 */
export function MergedSourcesToggle({
  count,
  expanded,
  onToggle,
  controls,
  budgetName,
  disabled,
}: MergedSourcesToggleProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={expanded}
      aria-controls={controls}
      className="gap-1.5"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "h-3.5 w-3.5 transition-transform duration-200",
          expanded && "rotate-180",
        )}
      >
        <path d="M6 8l4 4 4-4" />
      </svg>
      {/* Short on purpose: the control shares a row with View, the lock and
          the expense count, and a phone has no room for a sentence. The
          chevron and `aria-expanded` carry the open/closed state. */}
      {MERGED_LABEL} ({count})
      <span className="sr-only">
        {expanded ? " — hide the " : " — show the "}
        {count === 1 ? "allotment" : "allotments"} folded into {budgetName}
      </span>
    </Button>
  );
}
