"use client";

import { useEffect, useRef, useState } from "react";

import type { BudgetSummary } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { formatCurrency } from "@/lib/currency";
import { sumAmounts } from "@/lib/calculations";
import { describeBudgetPeriod, isGeneralBudget, NO_DATE_LABEL } from "@/lib/budgets";
import { formatShortDateRange } from "@/lib/dates";
import { MAX_BUDGET_NAME_LENGTH } from "@/lib/validation";

const FORM_ID = "merge-budgets-form";

export interface MergeBudgetsModalProps {
  open: boolean;
  onClose: () => void;
  /** Exactly the two allotments being folded together. */
  sources: [BudgetSummary, BudgetSummary] | null;
}

/** One source's figures, laid out the same way on both sides of the sum. */
function SourceCard({ summary }: { summary: BudgetSummary }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-muted p-3.5">
      <p className="truncate text-[0.9375rem] font-medium text-foreground">
        {summary.budget.name}
      </p>
      <p className="mt-0.5 text-[0.8125rem] text-muted">
        {describeBudgetPeriod(summary.budget)}
      </p>

      <dl className="mt-2.5 space-y-1 text-[0.8125rem]">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted">Allocated</dt>
          <dd className="font-medium tabular text-foreground">
            {formatCurrency(summary.budget.amount)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted">Spent</dt>
          <dd className="font-medium tabular text-foreground">
            {formatCurrency(summary.totalExpenses)}
          </dd>
        </div>
        {summary.totalTransferred > 0 ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">Moved</dt>
            <dd className="font-medium tabular text-foreground">
              {formatCurrency(summary.totalTransferred)}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Confirms a merge, and says exactly what it will do.
 *
 * The whole point of the summary is that a merge is irreversible and touches
 * two allotments at once: the user should be able to check the arithmetic
 * before committing rather than discover it afterwards. Nothing here is
 * editable except the name — the amount is the sum and the period is derived,
 * because a merge that let either be typed in could change how much money
 * exists.
 */
export function MergeBudgetsModal({ open, onClose, sources }: MergeBudgetsModalProps) {
  const { mergeBudgets } = useTracker();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  /**
   * True from submit until the server answers.
   *
   * A merge is not repeatable — the second attempt would find its sources
   * already folded in — so a double tap has to be impossible here as well as
   * refused on the server.
   */
  const [merging, setMerging] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(undefined);
    setMerging(false);
  }, [open, sources]);

  if (!sources) return null;
  const [first, second] = sources;

  const amount = sumAmounts([first.budget.amount, second.budget.amount]);
  const expenses = sumAmounts([first.totalExpenses, second.totalExpenses]);
  const transferred = sumAmounts([first.totalTransferred, second.totalTransferred]);
  const remaining = sumAmounts([first.remaining, second.remaining]);

  /*
   * The period the merged allotment will carry, mirrored from the rule the
   * server applies. Shown rather than chosen, so the user is never surprised by
   * an allotment that covers different days than the ones they merged.
   */
  const unrestricted =
    isGeneralBudget(first.budget) || isGeneralBudget(second.budget);
  const startDate =
    !unrestricted && first.budget.startDate! < second.budget.startDate!
      ? first.budget.startDate!
      : second.budget.startDate!;
  const endDate =
    !unrestricted && first.budget.endDate! > second.budget.endDate!
      ? first.budget.endDate!
      : second.budget.endDate!;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (merging) return;

    if (name.trim() === "") {
      setError("Give the merged allotment a name.");
      nameRef.current?.focus();
      return;
    }

    setMerging(true);
    const merged = await mergeBudgets({
      sourceBudgetIds: [first.budget.id, second.budget.id],
      name: name.trim(),
    });

    if (!merged) {
      setMerging(false);
      return;
    }

    showToast(
      `${first.budget.name} and ${second.budget.name} merged into ${merged.name}`,
      "positive",
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={merging ? () => {} : onClose}
      title="Merge Budget Allotments?"
      description="The two allotments become one. Every expense is kept exactly as it is."
      footer={
        <>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={merging}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            className="flex-1"
            disabled={merging}
            aria-busy={merging}
          >
            {merging ? "Merging…" : "Merge Budgets"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <SourceCard summary={first} />
          <p aria-hidden="true" className="text-center text-sm font-medium text-muted">
            +
          </p>
          <SourceCard summary={second} />
        </div>

        <TextField
          ref={nameRef}
          label="New Budget Name"
          placeholder="Combined Food & Weekend Budget"
          value={name}
          maxLength={MAX_BUDGET_NAME_LENGTH}
          autoComplete="off"
          error={error}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(undefined);
          }}
        />

        {/* The result, computed rather than entered. */}
        <div className="rounded-xl border border-border-strong bg-surface-muted p-4">
          <p className="text-[0.8125rem] font-medium tracking-wide text-muted">
            New allotment
          </p>
          <p className="mt-0.5 truncate text-[0.9375rem] font-semibold text-foreground">
            {name.trim() === "" ? "Unnamed" : name.trim()}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            {unrestricted ? NO_DATE_LABEL : formatShortDateRange(startDate, endDate)}
          </p>

          <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Allocated</dt>
              <dd className="font-semibold tabular text-foreground">
                {formatCurrency(amount)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Spent</dt>
              <dd className="font-semibold tabular text-foreground">
                {formatCurrency(expenses)}
              </dd>
            </div>
            {transferred > 0 ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Moved</dt>
                <dd className="font-semibold tabular text-foreground">
                  {formatCurrency(transferred)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-1.5">
              <dt className="text-muted">Remaining</dt>
              <dd className="font-semibold tabular text-foreground">
                {formatCurrency(remaining)}
              </dd>
            </div>
          </dl>
        </div>

        <p className="text-[0.8125rem] text-muted">
          All existing expenses are preserved and move to the new allotment —
          nothing is deleted, duplicated or repriced. The two originals are kept
          as records of what they held.{" "}
          <span className="font-medium text-foreground">
            This cannot be undone.
          </span>
        </p>
      </form>
    </Modal>
  );
}
