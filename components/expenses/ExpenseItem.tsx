"use client";

import { useMemo } from "react";

import type { Expense } from "@/types/expense";
import { formatCurrency } from "@/lib/currency";
import { formatShortDateKey } from "@/lib/dates";

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M13.5 3.9a1.7 1.7 0 0 1 2.4 2.4l-8 8-3.2.8.8-3.2 8-8Z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M4.5 5.5h11M8 5.5V4.2A1.2 1.2 0 0 1 9.2 3h1.6A1.2 1.2 0 0 1 12 4.2v1.3M6 5.5l.6 9.3A1.2 1.2 0 0 0 7.8 16h4.4a1.2 1.2 0 0 0 1.2-1.2l.6-9.3" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <rect x="4.5" y="8.5" width="11" height="7.5" rx="2" />
      <path d="M7.5 8.5V6.5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export interface ExpenseItemProps {
  expense: Expense;
  /** Name of the allotment this expense is charged to. */
  budgetName?: string;
  /**
   * The allotment behind this expense is fully spent, so the row is a record:
   * it shows a lock instead of Edit and Delete.
   */
  locked?: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}

/** A single row in the expense list. */
export function ExpenseItem({
  expense,
  budgetName,
  locked = false,
  onEdit,
  onDelete,
}: ExpenseItemProps) {
  const monogram = useMemo(
    () => expense.name.trim().charAt(0).toUpperCase() || "?",
    [expense.name],
  );

  const dateLabel = formatShortDateKey(expense.expenseDate);

  return (
    <li className="group flex animate-rise-in items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-muted sm:gap-4 sm:px-5">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-muted-strong ring-1 ring-inset ring-border-subtle"
      >
        {monogram}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.9375rem] font-medium text-foreground">
          {expense.name}
        </p>
        <p className="text-[0.8125rem] text-muted">
          <time dateTime={expense.expenseDate}>{dateLabel}</time>
        </p>
        {/* The allotment gets its own line: sharing one with the date left it
            truncated to "Emerge…" on a phone, which is no answer to "where did
            this money come from?". */}
        {budgetName ? (
          <p className="truncate text-[0.8125rem] font-medium text-muted-strong">
            {budgetName}
          </p>
        ) : null}
      </div>

      <p className="shrink-0 text-[0.9375rem] font-semibold tabular text-foreground">
        {formatCurrency(expense.amount)}
      </p>

      {/* Hidden, not disabled: a greyed-out Edit invites a click and then
          explains itself, while the lock says up front that this row is
          finished. The server refuses the write either way. */}
      {locked ? (
        <span
          title={`${budgetName ?? "This budget"} is fully spent — this expense is locked`}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-muted"
        >
          <span className="sr-only">Locked — this budget is fully spent</span>
          <LockIcon />
        </span>
      ) : (
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => onEdit(expense)}
          aria-label={`Edit ${expense.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          onClick={() => onDelete(expense)}
          aria-label={`Delete ${expense.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <DeleteIcon />
        </button>
      </div>
      )}
    </li>
  );
}
