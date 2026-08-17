"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Budget } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField } from "@/components/ui/TextField";
import { DateField } from "@/components/ui/DateField";
import { CURRENCY_SYMBOL, formatAmount, formatCurrency } from "@/lib/currency";
import { formatDateRange, todayKey } from "@/lib/dates";
import { expensesOutsidePeriod, findOverlaps } from "@/lib/budgets";
import {
  MAX_BUDGET_NAME_LENGTH,
  describeStrandedExpenses,
  validateBudgetForm,
  type BudgetFormErrors,
} from "@/lib/validation";
import { cn } from "@/lib/utils";

const FORM_ID = "budget-form";

type PeriodMode = "single" | "range";

export interface BudgetFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Provide a budget to edit it; omit to create a new one. */
  budget?: Budget | null;
  /** Pre-fills the period, e.g. when creating a budget for an uncovered date. */
  initialDate?: string;
}

/**
 * Create / edit a budget allotment.
 *
 * Overlapping periods are rejected here rather than resolved later: if two
 * budgets could claim the same day, every expense on that day becomes a
 * question. Blocking it at the one moment the user can cheaply change the dates
 * keeps expense entry unambiguous forever after.
 */
export function BudgetFormModal({
  open,
  onClose,
  budget = null,
  initialDate,
}: BudgetFormModalProps) {
  const { budgets, expensesFor, createBudget, updateBudget } = useTracker();
  const { showToast } = useToast();

  const isEditing = budget !== null;
  const today = todayKey();

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PeriodMode>("single");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [errors, setErrors] = useState<BudgetFormErrors>({});
  const [pendingConfirm, setPendingConfirm] = useState<null | {
    name: string;
    amount: number;
    startDate: string;
    endDate: string;
  }>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    if (budget) {
      setName(budget.name);
      setAmount(formatAmount(budget.amount));
      setMode(budget.startDate === budget.endDate ? "single" : "range");
      setStartDate(budget.startDate);
      setEndDate(budget.endDate);
    } else {
      const seed = initialDate ?? today;
      setName("");
      setAmount("");
      setMode("single");
      setStartDate(seed);
      setEndDate(seed);
    }
    setErrors({});
    setPendingConfirm(null);
  }, [open, budget, initialDate, today]);

  // A single-day budget is just a period whose ends match — the user never has
  // to type the same date twice.
  const effectiveEnd = mode === "single" ? startDate : endDate;

  const recordedExpenses = useMemo(
    () => (budget ? expensesFor(budget.id) : []),
    [budget, expensesFor],
  );

  const stranded = useMemo(() => {
    if (!budget) return [];
    return expensesOutsidePeriod(budget, recordedExpenses, {
      startDate,
      endDate: effectiveEnd,
    });
  }, [budget, recordedExpenses, startDate, effectiveEnd]);

  const overlaps = useMemo(
    () => findOverlaps(budgets, startDate, effectiveEnd, budget?.id),
    [budgets, startDate, effectiveEnd, budget?.id],
  );

  const commit = (values: {
    name: string;
    amount: number;
    startDate: string;
    endDate: string;
  }) => {
    if (isEditing && budget) {
      updateBudget(budget.id, values);
      showToast(`${values.name} updated and locked`, "positive");
    } else {
      createBudget(values);
      showToast(`${values.name} created`, "positive");
    }
    setPendingConfirm(null);
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = validateBudgetForm(name, amount, startDate, effectiveEnd, {
      budgets,
      excludeId: budget?.id,
    });

    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.name) nameRef.current?.focus();
      return;
    }

    // Narrowing a period must not strand expenses outside the budget paying for
    // them — that would leave an expense with no applicable allotment.
    if (stranded.length > 0) {
      setErrors({ period: describeStrandedExpenses(stranded) });
      return;
    }

    setErrors({});
    const values = result.values!;

    // Editing terms that already have spending against them changes this
    // budget's arithmetic, so make the user acknowledge it.
    const termsChanged =
      budget !== null &&
      (budget.amount !== values.amount ||
        budget.startDate !== values.startDate ||
        budget.endDate !== values.endDate);

    if (termsChanged && recordedExpenses.length > 0) {
      setPendingConfirm(values);
      return;
    }

    commit(values);
  };

  const parsedAmount = Number(amount.replace(/[₱,\s]/g, ""));
  const previewAmount = Number.isFinite(parsedAmount) ? parsedAmount : 0;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEditing ? "Edit Budget Allotment" : "Add Budget Allotment"}
        description={
          isEditing
            ? "Changing the amount or dates affects only this allotment."
            : "Name it, set the amount, and choose the days it covers."
        }
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} className="flex-1">
              {isEditing ? "Save changes" : "Add Budget"}
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
          <TextField
            ref={nameRef}
            label="Budget Name"
            placeholder="Food Budget"
            value={name}
            maxLength={MAX_BUDGET_NAME_LENGTH}
            autoComplete="off"
            error={errors.name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
            }}
          />

          <TextField
            label="Budget Amount"
            placeholder="5,000.00"
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            prefix={CURRENCY_SYMBOL}
            className="font-semibold tabular"
            error={errors.amount}
            onChange={(event) => {
              setAmount(event.target.value);
              if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
            }}
          />

          <fieldset>
            <legend className="text-sm font-medium text-muted-strong">
              Applicable Period
            </legend>

            <div
              role="radiogroup"
              aria-label="Applicable period"
              className="mt-1.5 inline-flex rounded-xl border border-border-subtle bg-surface-muted p-1"
            >
              {(["single", "range"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => {
                    setMode(value);
                    if (value === "range" && endDate < startDate) setEndDate(startDate);
                    setErrors((prev) => ({ ...prev, period: undefined }));
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-150",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    mode === value
                      ? "bg-surface text-foreground shadow-card"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {value === "single" ? "Single date" : "Date range"}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <DateField
                label={mode === "single" ? "Applicable Date" : "Start Date"}
                value={startDate}
                invalid={errors.period !== undefined}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  if (mode === "range" && endDate < event.target.value) {
                    setEndDate(event.target.value);
                  }
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }}
              />

              {mode === "range" ? (
                <DateField
                  label="End Date"
                  value={endDate}
                  min={startDate}
                  invalid={errors.period !== undefined}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                    setErrors((prev) => ({ ...prev, period: undefined }));
                  }}
                />
              ) : null}
            </div>

            {errors.period ? (
              <p role="alert" className="mt-1.5 text-sm text-danger">
                {errors.period}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-muted">
                Applies {formatDateRange(startDate, effectiveEnd)}
                {mode === "single" ? " only" : ""}.
              </p>
            )}
          </fieldset>

          {/* Surface the clash while the dates are still being chosen, rather
              than only on submit. */}
          {overlaps.length > 0 && !errors.period ? (
            <div
              role="status"
              className="rounded-xl border border-warning/30 bg-warning-soft p-3.5"
            >
              <p className="text-sm font-medium text-warning">
                This period overlaps another budget
              </p>
              <ul className="mt-1.5 space-y-1 text-[0.8125rem] text-muted-strong">
                {overlaps.map((conflict) => (
                  <li key={conflict.budget.id}>
                    <span className="font-medium text-foreground">
                      {conflict.budget.name}
                    </span>{" "}
                    shares {formatDateRange(conflict.start, conflict.end)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.8125rem] text-muted-strong">
                Budgets cannot share dates — adjust the period to continue.
              </p>
            </div>
          ) : null}

          {previewAmount > 0 && overlaps.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">
              {formatCurrency(previewAmount)} allotted for this period.
            </p>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingConfirm !== null}
        title="This budget already has expenses"
        description="Changing its amount or dates will recalculate this allotment's balance."
        confirmLabel="Save changes"
        cancelLabel="Go back"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => pendingConfirm && commit(pendingConfirm)}
      >
        {pendingConfirm && budget ? (
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Recorded expenses</dt>
              <dd className="font-medium tabular text-foreground">
                {recordedExpenses.length}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Amount</dt>
              <dd className="font-medium tabular text-foreground">
                {formatCurrency(budget.amount)} → {formatCurrency(pendingConfirm.amount)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-2">
              <dt className="text-muted">Period</dt>
              <dd className="text-right text-[0.8125rem] font-medium text-foreground">
                {formatDateRange(budget.startDate, budget.endDate)}
                <br />→ {formatDateRange(pendingConfirm.startDate, pendingConfirm.endDate)}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
