"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Budget, BudgetApplicability } from "@/types/budget";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField } from "@/components/ui/TextField";
import { DateField } from "@/components/ui/DateField";
import { CURRENCY_SYMBOL, formatAmount, formatCurrency } from "@/lib/currency";
import { formatDateRange, todayKey } from "@/lib/dates";
import {
  NO_DATE_PERIOD_LABEL,
  budgetApplicability,
  describeBudgetPeriodLong,
  expensesOutsidePeriod,
  findOverlaps,
} from "@/lib/budgets";
import {
  MAX_BUDGET_NAME_LENGTH,
  describeStrandedExpenses,
  validateBudgetForm,
  type BudgetFormErrors,
} from "@/lib/validation";
import { cn } from "@/lib/utils";

const FORM_ID = "budget-form";

interface PendingValues {
  name: string;
  amount: number;
  startDate: string | null;
  endDate: string | null;
}

const MODES: Array<{ value: BudgetApplicability; label: string }> = [
  { value: "general", label: "No Specific Date" },
  { value: "single", label: "Single Date" },
  { value: "range", label: "Date Range" },
];

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
 * An allotment is either tied to the calendar or not, and that choice comes
 * first because it decides whether the date fields mean anything at all. A
 * general budget stores two nulls rather than wide sentinel dates, so nothing
 * downstream has to pretend the year 1900 was a real budget period.
 *
 * Overlapping periods are allowed and merely pointed out: every expense names
 * the budget it comes from, so two allotments covering one day is a choice the
 * user makes at entry time rather than a contradiction in the data.
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
  const [mode, setMode] = useState<BudgetApplicability>("general");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [errors, setErrors] = useState<BudgetFormErrors>({});
  const [pendingConfirm, setPendingConfirm] = useState<PendingValues | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    if (budget) {
      setName(budget.name);
      setAmount(formatAmount(budget.amount));
      setMode(budgetApplicability(budget));
      // Seed the pickers with today when the budget has no dates, so switching
      // to a dated mode starts somewhere sensible instead of empty.
      setStartDate(budget.startDate ?? today);
      setEndDate(budget.endDate ?? today);
    } else {
      const seed = initialDate ?? today;
      setName("");
      setAmount("");
      // A date was supplied only when the user came from an uncovered expense
      // date, which is the one case where a dated budget is the likely intent.
      setMode(initialDate ? "single" : "general");
      setStartDate(seed);
      setEndDate(seed);
    }
    setErrors({});
    setPendingConfirm(null);
  }, [open, budget, initialDate, today]);

  // A single-day budget is a period whose ends match — the user never types the
  // same date twice — and a general one has no period at all.
  const effectiveStart = mode === "general" ? null : startDate;
  const effectiveEnd =
    mode === "general" ? null : mode === "single" ? startDate : endDate;

  const recordedExpenses = useMemo(
    () => (budget ? expensesFor(budget.id) : []),
    [budget, expensesFor],
  );

  const stranded = useMemo(() => {
    if (!budget) return [];
    return expensesOutsidePeriod(budget, recordedExpenses, {
      startDate: effectiveStart,
      endDate: effectiveEnd,
    });
  }, [budget, recordedExpenses, effectiveStart, effectiveEnd]);

  const overlaps = useMemo(
    () =>
      mode === "general"
        ? []
        : findOverlaps(budgets, startDate, effectiveEnd!, budget?.id),
    [mode, budgets, startDate, effectiveEnd, budget?.id],
  );

  const commit = (values: PendingValues) => {
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

    const result = validateBudgetForm(name, amount, mode, startDate, endDate);

    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.name) nameRef.current?.focus();
      return;
    }

    // Narrowing a period must not strand expenses outside the budget paying for
    // them — that would leave an expense charged to an allotment that no longer
    // applies to its date.
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

  const periodSentence =
    mode === "general"
      ? "Available for any expense date."
      : `Applies ${formatDateRange(startDate, effectiveEnd!)}${
          mode === "single" ? " only" : ""
        }.`;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEditing ? "Edit Budget Allotment" : "Create Budget Allotment"}
        description={
          isEditing
            ? "Changing the amount or dates affects only this allotment."
            : "Name it, set the amount, and choose when it applies."
        }
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} className="flex-1">
              {isEditing ? "Save changes" : "Create Budget"}
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
          <TextField
            ref={nameRef}
            label="Budget Name"
            placeholder="Emergency Fund"
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
            placeholder="10,000.00"
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
              Applicability
            </legend>

            <div
              role="radiogroup"
              aria-label="Applicability"
              className="mt-1.5 flex flex-wrap gap-1 rounded-xl border border-border-subtle bg-surface-muted p-1"
            >
              {MODES.map(({ value, label }) => (
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
                    "flex-1 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-150",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    mode === value
                      ? "bg-surface text-foreground shadow-card"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* The date fields are removed rather than disabled: a greyed-out
                picker still implies the dates are being stored. */}
            {mode === "general" ? (
              <p className="mt-3 rounded-xl border border-border-subtle bg-surface-muted p-3.5 text-[0.8125rem] text-muted-strong">
                <span className="font-medium text-foreground">
                  {NO_DATE_PERIOD_LABEL}.
                </span>{" "}
                This allotment can fund an expense on any date, and stays
                available until you change or delete it.
              </p>
            ) : (
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
            )}

            {errors.period ? (
              <p role="alert" className="mt-1.5 text-sm text-danger">
                {errors.period}
              </p>
            ) : mode !== "general" ? (
              <p className="mt-1.5 text-sm text-muted">{periodSentence}</p>
            ) : null}
          </fieldset>

          {/* Advisory only. Overlapping allotments are legal now that each
              expense names its own budget. */}
          {overlaps.length > 0 && !errors.period ? (
            <div
              role="status"
              className="rounded-xl border border-border-subtle bg-surface-muted p-3.5"
            >
              <p className="text-sm font-medium text-foreground">
                Another allotment also covers these dates
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
              <p className="mt-2 text-[0.8125rem] text-muted">
                That is allowed — you will choose which allotment funds each
                expense when you record it.
              </p>
            </div>
          ) : null}

          {previewAmount > 0 ? (
            <p className="text-[0.8125rem] text-muted">
              {formatCurrency(previewAmount)} allotted{" "}
              {mode === "general" ? "with no date restriction" : "for this period"}.
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
              <dt className="text-muted">Applicability</dt>
              <dd className="text-right text-[0.8125rem] font-medium text-foreground">
                {describeBudgetPeriodLong(budget)}
                <br />→ {describeBudgetPeriodLong(pendingConfirm)}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
