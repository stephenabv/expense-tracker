"use client";

import { useId, useState } from "react";

import type { Budget, MergedSourceNode } from "@/types/budget";
import { Button } from "@/components/ui/Button";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { LockIcon } from "@/components/budgets/LockIcon";
import { MergedSourcesToggle } from "@/components/budgets/MergedSourcesToggle";
import { formatCurrency } from "@/lib/currency";
import {
  MERGED_LABEL,
  NO_DATE_LABEL,
  describeBudgetPeriodLong,
} from "@/lib/budgets";
import { cn } from "@/lib/utils";

interface MergedFigure {
  label: string;
  value: number;
}

/** One figure from the merge snapshot, laid out like the card's own. */
function Figure({ label, value }: MergedFigure) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[0.8125rem] font-semibold tabular text-foreground">
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

function MergedSourceRow({
  node,
  onView,
}: {
  node: MergedSourceNode;
  onView: (budget: Budget) => void;
}) {
  const { summary, snapshot, sources } = node;
  const { budget } = summary;
  const [expanded, setExpanded] = useState(false);
  const rowId = useId();
  const panelId = `${rowId}merged`;

  /*
   * The snapshot, not the live row.
   *
   * Once the expenses have moved, the source reads as ₱0 spent with its whole
   * allotment intact — exactly backwards. What it held when it was folded in is
   * the only honest account of it.
   */
  const spent = snapshot?.totalExpenses ?? summary.totalExpenses;
  const moved = snapshot?.totalTransferred ?? summary.totalTransferred;
  const remaining = snapshot?.remaining ?? summary.remaining;
  const amount = snapshot?.amount ?? budget.amount;

  return (
    <li className="rounded-xl border border-border-subtle bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-[0.8125rem] font-semibold tracking-tight text-foreground">
            {budget.name}
          </h4>
          <p className="mt-0.5 text-[0.75rem] text-muted">
            {summary.applicability === "general"
              ? NO_DATE_LABEL
              : describeBudgetPeriodLong(budget)}
          </p>
        </div>
        <BudgetStatusBadge status="merged" />
      </div>

      <dl
        className={cn(
          "mt-2.5 grid gap-2",
          // Four figures will not fit across a phone; the fourth only appears
          // once money has actually been moved out.
          moved > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
        )}
      >
        <Figure label="Budget" value={amount} />
        <Figure label="Spent" value={spent} />
        {moved > 0 ? <Figure label="Moved" value={moved} /> : null}
        <Figure label="Remaining" value={remaining} />
      </dl>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onView(budget)}>
          View
        </Button>
        {/* A folded-in allotment is always closed, so its own expand control
            sits beside the lock, the same place a fully spent card puts it. */}
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[0.6875rem] font-medium text-muted-strong ring-1 ring-inset ring-border-subtle">
          <LockIcon open={false} />
          Locked
        </span>
        {sources.length > 0 ? (
          <MergedSourcesToggle
            count={sources.length}
            expanded={expanded}
            onToggle={() => setExpanded((open) => !open)}
            controls={panelId}
            budgetName={budget.name}
          />
        ) : null}
        <span className="ml-auto text-[0.75rem] text-muted">
          Expenses moved with it
        </span>
      </div>

      {/* A chain of merges: this allotment was itself made by one before being
          folded in, and the allotments it held are still a record. */}
      {expanded && sources.length > 0 ? (
        <MergedSourcesPanel id={panelId} sources={sources} onView={onView} nested />
      ) : null}
    </li>
  );
}

export interface MergedSourcesPanelProps {
  /** Matches the `aria-controls` of the toggle that reveals this panel. */
  id: string;
  sources: MergedSourceNode[];
  onView: (budget: Budget) => void;
  /** Set when the panel is opening inside another one, to keep it quieter. */
  nested?: boolean;
}

/**
 * The merge record of one allotment, shown directly beneath it.
 *
 * Its own section used to sit at the bottom of the page, which left the user to
 * match a folded-away allotment to the budget it went into by reading names.
 * Here the record is where the money is.
 */
export function MergedSourcesPanel({
  id,
  sources,
  onView,
  nested = false,
}: MergedSourcesPanelProps) {
  if (sources.length === 0) return null;

  return (
    <div
      id={id}
      className={cn(
        "mt-3 rounded-xl border border-border-subtle bg-surface-muted p-3",
        nested && "bg-surface",
      )}
    >
      <p className="text-[0.75rem] font-semibold tracking-tight text-foreground">
        {MERGED_LABEL} Allotments
      </p>
      {/* Said once. A chain of merges opens panel inside panel, and repeating
          the explanation at every level would bury the figures it explains. */}
      {nested ? null : (
        <p className="mt-0.5 text-[0.75rem] text-muted">
          Folded into this one. Their expenses moved with them and are kept in
          full; these remain as records of what they held.
        </p>
      )}
      <ul className="mt-2.5 space-y-2.5">
        {sources.map((node) => (
          <MergedSourceRow key={node.summary.budget.id} node={node} onView={onView} />
        ))}
      </ul>
    </div>
  );
}
