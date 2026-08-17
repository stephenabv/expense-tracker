"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatCard } from "@/components/ui/StatCard";
import { CURRENCY_SYMBOL, formatCurrency } from "@/lib/currency";
import { validateBudget } from "@/lib/validation";
import { cn } from "@/lib/utils";

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <rect x="4.5" y="8.5" width="11" height="7.5" rx="2" />
      {open ? (
        <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 4.9-.7" />
      ) : (
        <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 5 0v2" />
      )}
    </svg>
  );
}

/**
 * Budget allotment with an explicit lock.
 *
 * A saved budget is read-only until the user chooses Edit, so it cannot be
 * changed by accident, and lowering it below what has already been spent needs a
 * second confirmation.
 */
export function BudgetCard() {
  const { budget, totals, setBudget } = useTracker();
  const { showToast } = useToast();

  const isConfigured = budget !== null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pendingValue, setPendingValue] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(budget !== null ? String(budget) : "");
    setError(undefined);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setError(undefined);
    setDraft("");
  };

  const commit = (value: number) => {
    setBudget(value);
    setEditing(false);
    setError(undefined);
    setPendingValue(null);
    showToast(
      isConfigured ? "Budget updated and locked" : "Budget set and locked",
      "positive",
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = validateBudget(draft);
    if (!result.ok) {
      setError(result.error);
      inputRef.current?.focus();
      return;
    }

    const value = result.value!;

    // Lowering the budget below what is already spent would push the balance
    // negative — make the user acknowledge that explicitly.
    if (value < totals.totalExpenses) {
      setPendingValue(value);
      return;
    }

    commit(value);
  };

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        editing
          ? "bg-warning-soft text-warning"
          : "bg-surface-muted text-muted ring-1 ring-inset ring-border-subtle",
      )}
    >
      <LockIcon open={editing} />
      {editing ? "Editing" : "Locked"}
    </span>
  );

  if (editing) {
    return (
      <>
        <div className="col-span-2 flex flex-col rounded-2xl border border-border-strong bg-surface p-4 shadow-raised sm:col-span-1 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[0.8125rem] font-medium tracking-wide text-muted">
              Budget Allotment
            </p>
            {badge}
          </div>

          <form onSubmit={handleSubmit} className="mt-3">
            <label htmlFor={inputId} className="sr-only">
              Budget allotment in Philippine pesos
            </label>

            <div
              className={cn(
                "flex items-center rounded-xl border bg-surface transition-colors",
                "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
                error ? "border-danger" : "border-border-subtle",
              )}
            >
              <span aria-hidden="true" className="pl-3 pr-1 text-base text-muted">
                {CURRENCY_SYMBOL}
              </span>
              <input
                ref={inputRef}
                id={inputId}
                data-focus-ring="none"
                inputMode="decimal"
                autoComplete="off"
                placeholder="13,000.00"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (error) setError(undefined);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-11 w-full min-w-0 bg-transparent pr-3 text-base font-semibold tabular text-foreground placeholder:font-normal placeholder:text-muted/70 focus:outline-none focus-visible:outline-none"
              />
            </div>

            {error ? (
              <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={cancelEditing}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="flex-1">
                Save budget
              </Button>
            </div>
          </form>
        </div>

        <ConfirmDialog
          open={pendingValue !== null}
          title="Budget is below your spending"
          description="Saving this will leave you with a negative balance."
          confirmLabel="Save anyway"
          cancelLabel="Go back"
          onCancel={() => setPendingValue(null)}
          onConfirm={() => {
            if (pendingValue !== null) commit(pendingValue);
          }}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">New budget</dt>
              <dd className="font-medium tabular text-foreground">
                {formatCurrency(pendingValue ?? 0)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Already spent</dt>
              <dd className="font-medium tabular text-foreground">
                {formatCurrency(totals.totalExpenses)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-2">
              <dt className="text-muted">Resulting balance</dt>
              <dd className="font-semibold tabular text-danger">
                {formatCurrency((pendingValue ?? 0) - totals.totalExpenses)}
              </dd>
            </div>
          </dl>
        </ConfirmDialog>
      </>
    );
  }

  return (
    <StatCard
      className="col-span-2 sm:col-span-1"
      label="Budget Allotment"
      value={
        isConfigured ? (
          formatCurrency(budget)
        ) : (
          <span className="text-muted">Not set</span>
        )
      }
      caption={
        // Lock state sits beside its own control, keeping every card's label on
        // a single line so the three metrics stay visually aligned.
        <div className="flex flex-wrap items-center gap-2">
          {isConfigured ? badge : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={startEditing}
            className="-ml-2 h-7 px-2 text-[0.8125rem]"
          >
            {isConfigured ? "Unlock to edit" : "Set budget"}
          </Button>
        </div>
      }
    />
  );
}
