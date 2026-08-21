"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Budget } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { DateField } from "@/components/ui/DateField";
import { SelectField } from "@/components/ui/SelectField";
import {
  CURRENCY_SYMBOL,
  formatAmount,
  formatCurrency,
  parseAmount,
} from "@/lib/currency";
import { formatDateKey, todayKey } from "@/lib/dates";
import { describeBudgetPeriod, describeBudgetPeriodLong } from "@/lib/budgets";
import {
  MAX_NAME_LENGTH,
  validateExpenseForm,
  type ExpenseFormErrors,
} from "@/lib/validation";

const FORM_ID = "expense-form";

export interface ExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Provide an expense to edit it; omit to create a new one. */
  expense?: Expense | null;
  /** Opens the budget form when no allotment is available for the date. */
  onCreateBudget?: (date: string) => void;
}

/** One option row: the budget's name, when it applies, and what it has left. */
function budgetOptionLabel(budget: Budget, balance: number): string {
  return `${budget.name} · ${describeBudgetPeriod(budget)} · ${formatCurrency(
    Math.max(balance, 0),
  )} left`;
}

/**
 * Shared add/edit expense form.
 *
 * Every expense names the allotment it is deducted from. The date narrows the
 * choice — a budget for an unrelated period is never offered — but it never
 * makes the choice: with more than one eligible allotment the user must say
 * which pot pays, because only they know whether today's medicine comes out of
 * the daily allowance or the emergency fund.
 *
 * Changing the date re-derives the options. If the budget already chosen no
 * longer applies, the selection is cleared and the form says why, rather than
 * leaving the expense attached to an allotment that cannot fund it.
 */
export function ExpenseFormModal({
  open,
  onClose,
  expense = null,
  onCreateBudget,
}: ExpenseFormModalProps) {
  const { addExpense, updateExpense, availableBalanceFor, budgetsCovering } =
    useTracker();
  const { showToast } = useToast();

  const isEditing = expense !== null;
  const today = todayKey();

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [budgetId, setBudgetId] = useState("");
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  /** Set when a date change invalidated the budget that was selected. */
  const [displaced, setDisplaced] = useState(false);
  /**
   * Whether the current selection came from the user.
   *
   * An allotment auto-selected because it was the only option is not a choice;
   * if the date later makes several eligible, that selection is dropped and the
   * user is asked, rather than the form quietly keeping a pot they never picked.
   */
  const [chosenByUser, setChosenByUser] = useState(false);
  /**
   * True from the moment the form is submitted until the server answers.
   *
   * It both disables the button and short-circuits the handler, so a rapid
   * double-tap on a phone cannot record the same expense twice.
   */
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const date = expense?.expenseDate ?? today;
    setName(expense?.name ?? "");
    setAmount(expense ? formatAmount(expense.amount) : "");
    setExpenseDate(date);
    setBudgetId(expense?.budgetId ?? "");
    // An expense being edited already carries a deliberate assignment.
    setChosenByUser(expense !== null);
    setErrors({});
    setDisplaced(false);
    setSubmitting(false);
  }, [open, expense, today]);

  // Budgets that may fund this date: those whose period covers it, plus every
  // general allotment. Anything else is not an option at all.
  const eligible = useMemo(() => {
    if (!open) return [];
    return budgetsCovering(expenseDate);
  }, [open, expenseDate, budgetsCovering]);

  /*
   * Keep the selection honest as the date moves.
   *
   * One eligible budget is selected automatically — there is nothing to decide,
   * and the form still names it. Beyond that the form never resolves the
   * choice: if the date brings a second eligible allotment into play, or
   * invalidates the one selected, the selection is cleared and the user picks.
   */
  useEffect(() => {
    if (!open) return;

    const stillValid = eligible.some((budget) => budget.id === budgetId);

    if (stillValid) {
      // A selection the user did not make cannot stand once there is a choice.
      if (!chosenByUser && eligible.length > 1) setBudgetId("");
      return;
    }

    if (budgetId !== "") setDisplaced(true);

    if (eligible.length === 1) {
      setBudgetId(eligible[0].id);
      setChosenByUser(false);
    } else {
      setBudgetId("");
    }
  }, [open, eligible, budgetId, chosenByUser]);

  const selectedBudget = eligible.find((budget) => budget.id === budgetId) ?? null;

  const availableBalance = useMemo(() => {
    if (!open || !selectedBudget) return 0;
    return availableBalanceFor(selectedBudget.id, expense);
  }, [open, selectedBudget, availableBalanceFor, expense]);

  /** Balances for the option labels, so the user can choose with the figures. */
  const balances = useMemo(() => {
    const map = new Map<string, number>();
    if (!open) return map;
    for (const budget of eligible) {
      map.set(budget.id, availableBalanceFor(budget.id, expense));
    }
    return map;
  }, [open, eligible, availableBalanceFor, expense]);

  const parsedAmount = parseAmount(amount);
  const exceedsBalance =
    selectedBudget !== null &&
    parsedAmount !== null &&
    parsedAmount > 0 &&
    parsedAmount > availableBalance;

  const noBudget = eligible.length === 0;
  const mustChoose = eligible.length > 1;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const result = validateExpenseForm(name, amount, expenseDate, budgetId, {
      eligibleBudgets: eligible,
      availableBalance: selectedBudget ? availableBalance : undefined,
    });

    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.name) nameRef.current?.focus();
      return;
    }

    const values = result.values!;
    setSubmitting(true);

    // Only announce success once the server has actually accepted it, and only
    // close then: a refusal leaves the form open with the values intact.
    const write =
      isEditing && expense
        ? await updateExpense(expense.id, values)
        : await addExpense(values);

    if (!write.saved) {
      setSubmitting(false);
      return;
    }

    const saved = isEditing
      ? "Expense updated"
      : `${values.name} · ${formatCurrency(values.amount)} added`;

    // One message, not two: an expense that spends the last centavo closes its
    // allotment, and the user needs to hear that in the same breath — a second
    // toast a moment later would simply replace this one.
    showToast(
      write.completed
        ? `${saved}. ${write.completed.name} is now fully spent and locked.`
        : saved,
      "positive",
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Expense" : "Add Expense"}
      description={
        selectedBudget
          ? `Deducted from ${selectedBudget.name} · ${formatCurrency(
              Math.max(availableBalance, 0),
            )} available`
          : "Choose the allotment this expense is deducted from."
      }
      footer={
        <>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            className="flex-1"
            disabled={exceedsBalance || noBudget || submitting}
            aria-busy={submitting}
          >
            {submitting
              ? isEditing
                ? "Saving…"
                : "Adding Expense…"
              : isEditing
                ? "Save changes"
                : "Add Expense"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
        <TextField
          ref={nameRef}
          label="Expense Name"
          placeholder="Groceries"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          enterKeyHint="next"
          error={errors.name}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
          }}
        />

        <TextField
          label="Amount"
          placeholder="500.00"
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          prefix={CURRENCY_SYMBOL}
          className="font-semibold tabular"
          error={errors.amount}
          onChange={(event) => {
            setAmount(event.target.value);
            if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
          }}
        />

        <DateField
          label="Expense Date"
          value={expenseDate}
          invalid={errors.expenseDate !== undefined}
          onChange={(event) => {
            setExpenseDate(event.target.value);
            setErrors((prev) => ({
              ...prev,
              expenseDate: undefined,
              budgetId: undefined,
              amount: undefined,
            }));
          }}
        />

        {noBudget ? (
          <div
            role="alert"
            className="rounded-xl border border-warning/30 bg-warning-soft p-3.5"
          >
            <p className="text-sm font-medium text-warning">
              No budget allotment is available.
            </p>
            <p className="mt-1 text-[0.8125rem] text-muted-strong">
              Nothing covers {formatDateKey(expenseDate)}, and you have no
              allotment without a date restriction. Please create a budget
              allotment before adding this expense.
            </p>
            {onCreateBudget ? (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onCreateBudget(expenseDate)}
              >
                Create Budget
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <SelectField
              label="Budget Allotment"
              value={budgetId}
              error={errors.budgetId}
              hint={
                selectedBudget
                  ? `${describeBudgetPeriodLong(selectedBudget)} · deducted from this allotment`
                  : "Several allotments can fund this date — choose the one this belongs to."
              }
              onChange={(event) => {
                setBudgetId(event.target.value);
                setChosenByUser(event.target.value !== "");
                setDisplaced(false);
                setErrors((prev) => ({
                  ...prev,
                  budgetId: undefined,
                  amount: undefined,
                }));
              }}
            >
              {/* No blank option when there is only one choice: it is already
                  selected, and offering "none" would invite an invalid form. */}
              {mustChoose ? <option value="">Select a budget…</option> : null}
              {eligible.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budgetOptionLabel(budget, balances.get(budget.id) ?? 0)}
                </option>
              ))}
            </SelectField>

            {displaced && !budgetId ? (
              <p
                role="status"
                className="rounded-xl border border-warning/30 bg-warning-soft p-3.5 text-[0.8125rem] text-muted-strong"
              >
                <span className="font-medium text-warning">
                  That date changed which allotments apply.
                </span>{" "}
                The budget you had chosen cannot fund{" "}
                {formatDateKey(expenseDate)} — pick one of the allotments above.
              </p>
            ) : null}

            {selectedBudget ? (
              <dl className="rounded-xl border border-border-subtle bg-surface-muted p-3.5 text-[0.8125rem]">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Available Balance</dt>
                  <dd className="font-semibold tabular text-foreground">
                    {formatCurrency(Math.max(availableBalance, 0))}
                  </dd>
                </div>
              </dl>
            ) : null}
          </>
        )}

        {exceedsBalance && selectedBudget ? (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-soft p-3.5"
          >
            <p className="text-sm font-medium text-danger">
              Insufficient budget balance.
            </p>
            <dl className="mt-2 space-y-1 text-[0.8125rem]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-strong">Available</dt>
                <dd className="font-medium tabular text-foreground">
                  {formatCurrency(Math.max(availableBalance, 0))}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-strong">Expense</dt>
                <dd className="font-medium tabular text-foreground">
                  {formatCurrency(parsedAmount ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[0.8125rem] text-muted-strong">
              Lower the amount, choose another allotment, or raise{" "}
              {selectedBudget.name} first.
            </p>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
