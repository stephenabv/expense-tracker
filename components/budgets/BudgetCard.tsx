"use client";

import { useId, useState } from "react";

import type {
  Budget,
  BudgetMergeSource,
  BudgetSummary,
  MergedSourceNode,
} from "@/types/budget";
import { Button } from "@/components/ui/Button";
import { BudgetStatusBadge } from "@/components/budgets/BudgetStatusBadge";
import { LockIcon } from "@/components/budgets/LockIcon";
import { MergedSourcesPanel } from "@/components/budgets/MergedSourcesPanel";
import { MergedSourcesToggle } from "@/components/budgets/MergedSourcesToggle";
import { formatCurrency } from "@/lib/currency";
import {
  NO_DATE_LABEL,
  describeBudgetPeriodLong,
  isTransferred,
} from "@/lib/budgets";
import { cn } from "@/lib/utils";

export interface BudgetCardProps {
  summary: BudgetSummary;
  /** For a transferred allotment: the budget its money came from. */
  sourceName?: string;
  /** A budget whose period has passed: read-only, but still deletable. */
  immutable: boolean;
  /**
   * False when deleting would rewrite a transfer — either this allotment was
   * funded by one, or it funded another. Offering a Delete that the server
   * always refuses is worse than not offering it.
   */
  deletable?: boolean;
  /** For a merged allotment: the name of the one it was folded into. */
  mergedIntoName?: string;
  /**
   * What a merged allotment held at the moment it was folded in.
   *
   * Its live figures no longer describe it — the expenses moved to the budget
   * it became part of, so it now reads as ₱0 spent with its whole allotment
   * intact, which is exactly backwards. The snapshot is what it actually held.
   */
  snapshot?: BudgetMergeSource | null;
  /**
   * The allotments folded into this one, revealed by the card's own
   * Expand control. Their record belongs with the money, which is here.
   */
  mergedSources?: MergedSourceNode[];
  /** Opens the detail view of one of those folded-in allotments. */
  onViewSource?: (budget: Budget) => void;
  /** Renders the card as a selectable option while a merge is being set up. */
  selection?: {
    selected: boolean;
    /** Set when the pair is full and this card is not one of the two. */
    disabled?: boolean;
    onToggle: () => void;
  };
  onView: () => void;
  /** Omitted for a fully spent budget, which has no actions but View. */
  onEdit?: () => void;
  onDelete?: () => void;
}

/** One allotment: its terms, its own spend, and its own remaining balance. */
export function BudgetCard({
  summary,
  sourceName,
  immutable,
  deletable = true,
  mergedIntoName,
  snapshot,
  mergedSources = [],
  onViewSource,
  selection,
  onView,
  onEdit,
  onDelete,
}: BudgetCardProps) {
  const { budget, totalExpenses, remaining, status, spentRatio, isOverspent } = summary;
  const fullySpent = status === "fully-spent";
  const merged = status === "merged";

  const [showMerged, setShowMerged] = useState(false);
  const cardId = useId();
  const mergedPanelId = `${cardId}merged`;
  const hasMergedSources = mergedSources.length > 0 && onViewSource !== undefined;

  // A merged allotment reports what it held, not what its emptied row says.
  const totalSpent = snapshot?.totalExpenses ?? totalExpenses;
  const totalMoved = snapshot?.totalTransferred ?? summary.totalTransferred;
  const balance = snapshot?.remaining ?? remaining;
  const transferred = totalMoved > 0;

  /*
   * The lock the card already shows, whichever way the budget is closed. It is
   * built once because the Expand control anchors to it: "beside the lock" has
   * to mean the same place whether the allotment was spent out, folded away or
   * simply ran out of days.
   */
  const lockNotice =
    fullySpent || merged ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[0.6875rem] font-medium text-muted-strong ring-1 ring-inset ring-border-subtle">
        <LockIcon open={false} />
        Locked
      </span>
    ) : immutable ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-[0.6875rem] font-medium text-muted ring-1 ring-inset ring-border-subtle">
        <LockIcon open={false} />
        Period ended — locked
      </span>
    ) : null;

  const mergeToggle = (
    <MergedSourcesToggle
      count={mergedSources.length}
      expanded={showMerged}
      onToggle={() => setShowMerged((open) => !open)}
      controls={mergedPanelId}
      budgetName={budget.name}
      // While a merge is being set up the whole card is a checkbox; opening a
      // record from it would fight the selection.
      disabled={Boolean(selection)}
    />
  );

  // A budget spent to exactly its allotment hit the target; the amber "nearly
  // out" tone would read as a problem where there is none.
  const barTone = isOverspent
    ? "bg-danger"
    : fullySpent
      ? "bg-foreground"
      : spentRatio >= 0.85
        ? "bg-warning"
        : "bg-positive";

  return (
    <article
      className={cn(
        "flex animate-rise-in flex-col rounded-2xl border bg-surface p-4 shadow-card transition-shadow duration-200 hover:shadow-raised sm:p-5",
        // A closed budget is set apart from the open ones at a glance, without
        // being greyed out — it is a record, not a disabled control.
        fullySpent || merged ? "border-border-strong" : "border-border-subtle",
        selection?.selected && "ring-2 ring-ring",
        // Dimmed rather than hidden once the pair is full: the user can still
        // read the card they cannot currently pick.
        selection?.disabled && "opacity-50",
      )}
    >
      {/* While a merge is being set up the card itself is the control, so the
          whole thing is one target rather than a small checkbox to hunt for. */}
      {selection ? (
        <label className="mb-3 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={selection.selected}
            disabled={selection.disabled}
            onChange={selection.onToggle}
            aria-label={`Select ${budget.name} to merge`}
            className="h-4 w-4 shrink-0 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <span className="text-[0.8125rem] font-medium text-muted-strong">
            {selection.selected ? "Selected to merge" : "Select to merge"}
          </span>
        </label>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] font-semibold tracking-tight text-foreground">
            {budget.name}
          </h3>
          {/* Never blank: an allotment with no dates says so in the same slot
              the dates occupy, so the missing period cannot read as missing
              data. The status badge is suppressed below when it would only
              repeat this line. */}
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            {summary.applicability === "general"
              ? NO_DATE_LABEL
              : describeBudgetPeriodLong(budget)}
          </p>
          {/* Where the money came from, on the card itself — the origin is part
              of what this allotment is, not a detail buried a click away. */}
          {isTransferred(budget) ? (
            <p className="mt-0.5 truncate text-[0.75rem] font-medium text-muted-strong">
              Transferred{sourceName ? ` from ${sourceName}` : ""}
            </p>
          ) : null}
          {/* And where it went. Without this the card is a dead end: the user
              can see the allotment is gone but not what became of it. */}
          {merged && mergedIntoName ? (
            <p className="mt-0.5 truncate text-[0.75rem] font-medium text-muted-strong">
              Merged into {mergedIntoName}
            </p>
          ) : null}
        </div>
        {status === "unrestricted" ? null : <BudgetStatusBadge status={status} />}
      </div>

      {/*
       * Four columns once money has been moved out.
       *
       * Folding a transfer into "Spent" would report a purchase the user never
       * made; leaving it out entirely would leave the remaining balance
       * unexplained. It gets its own figure, and only when there is one.
       */}
      <dl
        className={cn(
          "mt-4 grid gap-3",
          // Four figures do not fit across a phone — squeezing them turns
          // ₱13,000.00 into "₱13,0…", which is worse than no figure at all.
          transferred ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
        )}
      >
        <div className="min-w-0">
          <dt className="text-[0.75rem] text-muted">Budget</dt>
          <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular text-foreground">
            {formatCurrency(budget.amount)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.75rem] text-muted">Spent</dt>
          <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular text-foreground">
            {formatCurrency(totalSpent)}
          </dd>
        </div>
        {transferred ? (
          <div className="min-w-0">
            <dt className="text-[0.75rem] text-muted">Moved</dt>
            <dd className="mt-0.5 truncate text-[0.9375rem] font-semibold tabular text-foreground">
              {formatCurrency(totalMoved)}
            </dd>
          </div>
        ) : null}
        <div className="min-w-0">
          <dt className="text-[0.75rem] text-muted">Remaining</dt>
          <dd
            className={cn(
              "mt-0.5 truncate text-[0.9375rem] font-semibold tabular",
              isOverspent ? "text-danger" : "text-foreground",
            )}
          >
            {formatCurrency(balance)}
          </dd>
        </div>
      </dl>

      <div
        className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted ring-1 ring-inset ring-border-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(spentRatio * 100)}
        aria-label={`Share of ${budget.name} spent`}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barTone)}
          style={{
            width: `${Math.max(
              (budget.amount > 0
                ? Math.min((totalSpent + totalMoved) / budget.amount, 1)
                : spentRatio) * 100,
              totalSpent + totalMoved > 0 ? 2 : 0,
            )}%`,
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onView} disabled={Boolean(selection)}>
          View
        </Button>

        {/*
         * The merge record is opened from the card holding the money, and from
         * one consistent place on it: beside View while the allotment is still
         * open, and beside the lock once it is closed — next to whichever
         * control says what state the budget is in.
         */}
        {hasMergedSources && !lockNotice ? mergeToggle : null}

        {/* A fully spent budget offers exactly one action. There is no edit, no
            delete and no unlock — not hidden behind a confirmation, simply not
            there, because the record is final. */}
        {lockNotice ? (
          <>
            {lockNotice}
            {hasMergedSources ? mergeToggle : null}
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            {deletable ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="text-muted hover:bg-danger-soft hover:text-danger"
              >
                Delete
              </Button>
            ) : null}
            <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-muted">
              <LockIcon open={!budget.locked} />
              {budget.locked ? "Locked" : "Unlocked"}
            </span>
          </>
        )}

        <span className="ml-auto text-[0.75rem] text-muted">
          {merged
            ? "Expenses moved with it"
            : summary.expenseCount === 1
              ? "1 expense"
              : `${summary.expenseCount} expenses`}
          {!merged && summary.transferCount > 0
            ? summary.transferCount === 1
              ? " · 1 transfer"
              : ` · ${summary.transferCount} transfers`
            : ""}
        </span>
      </div>

      {/* Directly under the budget it belongs to, not in a section of its own
          at the foot of the page. */}
      {showMerged && mergedSources.length > 0 && onViewSource ? (
        <MergedSourcesPanel
          id={mergedPanelId}
          sources={mergedSources}
          onView={onViewSource}
        />
      ) : null}
    </article>
  );
}
