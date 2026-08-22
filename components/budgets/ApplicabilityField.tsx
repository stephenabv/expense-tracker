"use client";

import type { BudgetApplicability } from "@/types/budget";
import { DateField } from "@/components/ui/DateField";
import { NO_DATE_PERIOD_LABEL } from "@/lib/budgets";
import { cn } from "@/lib/utils";

const MODES: Array<{ value: BudgetApplicability; label: string }> = [
  { value: "general", label: "No Specific Date" },
  { value: "single", label: "Single Date" },
  { value: "range", label: "Date Range" },
];

export interface ApplicabilityFieldProps {
  mode: BudgetApplicability;
  startDate: string;
  endDate: string;
  onModeChange: (mode: BudgetApplicability) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  error?: string;
  /** Distinguishes the two forms' radio groups for assistive technology. */
  label?: string;
  /** Replaces the sentence shown for an allotment with no date restriction. */
  generalNote?: string;
}

/**
 * When a budget allotment applies.
 *
 * Shared by the budget form and the transfer half of the expense form, because
 * an allotment created by moving money is an allotment like any other — it gets
 * the same three choices and the same rules, rather than a second, subtly
 * different date control that could drift from this one.
 */
export function ApplicabilityField({
  mode,
  startDate,
  endDate,
  onModeChange,
  onStartDateChange,
  onEndDateChange,
  error,
  label = "Applicability",
  generalNote,
}: ApplicabilityFieldProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-muted-strong">{label}</legend>

      <div
        role="radiogroup"
        aria-label={label}
        className="mt-1.5 flex flex-wrap gap-1 rounded-xl border border-border-subtle bg-surface-muted p-1"
      >
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => onModeChange(option.value)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              mode === option.value
                ? "bg-surface text-foreground shadow-card"
                : "text-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* The date fields are removed rather than disabled: a greyed-out picker
          still implies the dates are being stored. */}
      {mode === "general" ? (
        <p className="mt-3 rounded-xl border border-border-subtle bg-surface-muted p-3.5 text-[0.8125rem] text-muted-strong">
          <span className="font-medium text-foreground">{NO_DATE_PERIOD_LABEL}.</span>{" "}
          {generalNote ??
            "This allotment can fund an expense on any date, and stays available until you change or delete it."}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <DateField
            label={mode === "single" ? "Applicable Date" : "Start Date"}
            value={startDate}
            invalid={error !== undefined}
            onChange={(event) => onStartDateChange(event.target.value)}
          />

          {mode === "range" ? (
            <DateField
              label="End Date"
              value={endDate}
              min={startDate}
              invalid={error !== undefined}
              onChange={(event) => onEndDateChange(event.target.value)}
            />
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
