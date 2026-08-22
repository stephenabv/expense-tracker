"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Budget, BudgetApplicability } from "@/types/budget";
import type { Expense } from "@/types/expense";
import { useTracker } from "@/components/providers/TrackerProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import { DateField } from "@/components/ui/DateField";
import { SelectField } from "@/components/ui/SelectField";
import { ApplicabilityField } from "@/components/budgets/ApplicabilityField";
import {
  CURRENCY_SYMBOL,
  formatAmount,
  formatCurrency,
  parseAmount,
} from "@/lib/currency";
import { formatDateKey, todayKey } from "@/lib/dates";
import {
  describeBudgetPeriod,
  describeBudgetPeriodLong,
} from "@/lib/budgets";
import {
  MAX_BUDGET_NAME_LENGTH,
  MAX_NAME_LENGTH,
  validateExpenseForm,
  validateTransferForm,
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
 *
 * The same form also records a *transfer*. Moving ₱2,000 from Main Budget into
 * a new Emergency Fund starts exactly like an expense — pick the pot, name the
 * amount — and differs only in where the money lands, so it belongs here rather
 * than behind a second, near-identical screen. The toggle changes what the
 * fields mean: the allotment becomes the source, the name becomes the new
 * allotment's, and a period appears because what is being created is a budget.
 */
export function ExpenseFormModal({
  open,
  onClose,
  expense = null,
  onCreateBudget,
}: ExpenseFormModalProps) {
  const {
    addExpense,
    updateExpense,
    createTransfer,
    availableBalanceFor,
    budgetsCovering,
  } = useTracker();
  const { showToast } = useToast();

  const isEditing = expense !== null;
  const today = todayKey();

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [budgetId, setBudgetId] = useState("");
  const [errors, setErrors] = useState<ExpenseFormErrors & { period?: string }>({});

  /**
   * Whether this transaction creates an allotment instead of spending.
   *
   * Only offered when adding. Converting a recorded expense into a transfer
   * afterwards would mean inventing a budget for money already treated as
   * spent, so an existing row's kind is fixed.
   */
  const [asTransfer, setAsTransfer] = useState(false);
  const [mode, setMode] = useState<BudgetApplicability>("general");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
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
    setAsTransfer(false);
    setMode("general");
    setStartDate(date);
    setEndDate(date);
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
  /** The transfer amount, once it is a usable figure. */
  const transferAmount =
    parsedAmount !== null && parsedAmount > 0 ? parsedAmount : null;
  const exceedsBalance =
    selectedBudget !== null &&
    parsedAmount !== null &&
    parsedAmount > 0 &&
    parsedAmount > availableBalance;

  const noBudget = eligible.length === 0;
  const mustChoose = eligible.length > 1;

  /** Appends the source's closure to a success message, when it happened. */
  const withClosure = (message: string, completed: Budget | null) =>
    completed
      ? `${message}. ${completed.name} is now fully spent and locked.`
      : message;

  const submitTransfer = async () => {
    const result = validateTransferForm(
      name,
      amount,
      expenseDate,
      budgetId,
      mode,
      startDate,
      endDate,
      {
        eligibleBudgets: eligible,
        availableBalance: selectedBudget ? availableBalance : undefined,
      },
    );

    if (!result.ok) {
      // The source select carries the same error slot as an expense's budget.
      setErrors({ ...result.errors, budgetId: result.errors.sourceBudgetId });
      if (result.errors.name) nameRef.current?.focus();
      return;
    }

    const values = result.values!;
    setSubmitting(true);

    const write = await createTransfer({
      sourceBudgetId: values.sourceBudgetId,
      amount: values.amount,
      expenseDate: values.expenseDate,
      name: values.name,
      startDate: values.startDate,
      endDate: values.endDate,
    });

    if (!write.saved) {
      setSubmitting(false);
      return;
    }

    showToast(
      withClosure(
        `${formatCurrency(values.amount)} moved to ${values.name}`,
        write.completed,
      ),
      "positive",
    );
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (asTransfer && !isEditing) {
      await submitTransfer();
      return;
    }

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

    // One message, not two: an expense that spends the last centavo closes its
    // allotment, and the user needs to hear that in the same breath — a second
    // toast a moment later would simply replace this one.
    showToast(
      withClosure(
        isEditing
          ? "Expense updated"
          : `${values.name} · ${formatCurrency(values.amount)} added`,
        write.completed,
      ),
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
          ? `${asTransfer ? "Moved out of" : "Deducted from"} ${
              selectedBudget.name
            } · ${formatCurrency(Math.max(availableBalance, 0))} available`
          : asTransfer
            ? "Choose the allotment the money is moved out of."
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
                : asTransfer
                  ? "Creating Allotment…"
                  : "Adding Expense…"
              : isEditing
                ? "Save changes"
                : asTransfer
                  ? "Create Allotment"
                  : "Add Expense"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* One name field, not two. When the transaction creates an allotment
            the thing being named *is* that allotment, and a separate "expense
            name" alongside it would only ask the user to say the same thing
            twice. */}
        <TextField
          ref={nameRef}
          label={asTransfer ? "New Budget Allotment Name" : "Expense Name"}
          placeholder={asTransfer ? "Emergency Fund" : "Groceries"}
          value={name}
          maxLength={asTransfer ? MAX_BUDGET_NAME_LENGTH : MAX_NAME_LENGTH}
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

        {/* Offered only when adding: an expense already recorded cannot become a
            transfer without inventing an allotment for money already spent. */}
        {!isEditing && !noBudget ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-subtle bg-surface-muted p-3.5">
            <input
              type="checkbox"
              checked={asTransfer}
              onChange={(event) => {
                setAsTransfer(event.target.checked);
                setErrors({});
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Create this expense as a new budget allotment
              </span>
              <span className="mt-0.5 block text-[0.8125rem] text-muted">
                Moves the money into a new allotment instead of spending it. Your
                total funds do not change — only which pot holds them.
              </span>
            </span>
          </label>
        ) : null}

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
              label={asTransfer ? "Source Budget" : "Budget Allotment"}
              value={budgetId}
              error={errors.budgetId}
              hint={
                selectedBudget
                  ? `${describeBudgetPeriodLong(selectedBudget)} · ${
                      asTransfer
                        ? "the money is taken out of this allotment"
                        : "deducted from this allotment"
                    }`
                  : asTransfer
                    ? "Choose the allotment the money comes out of."
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

            {/* The allotment being created gets the same three choices as any
                other, because after this it is one. */}
            {asTransfer ? (
              <ApplicabilityField
                label="New Allotment Applicability"
                mode={mode}
                startDate={startDate}
                endDate={endDate}
                error={errors.period}
                generalNote="The new allotment can fund an expense on any date."
                onModeChange={(next) => {
                  setMode(next);
                  if (next === "range" && endDate < startDate) setEndDate(startDate);
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }}
                onStartDateChange={(value) => {
                  setStartDate(value);
                  if (mode === "range" && endDate < value) setEndDate(value);
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }}
                onEndDateChange={(value) => {
                  setEndDate(value);
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }}
              />
            ) : null}

            {/* Says the whole sentence back before it happens: which pot loses
                the money, how much, and what it becomes. */}
            {asTransfer && selectedBudget && transferAmount !== null ? (
              <p
                role="status"
                className="rounded-xl border border-border-subtle bg-surface-muted p-3.5 text-[0.8125rem] text-muted-strong"
              >
                <span className="font-semibold tabular text-foreground">
                  {formatCurrency(transferAmount)}
                </span>{" "}
                will be deducted from{" "}
                <span className="font-medium text-foreground">
                  {selectedBudget.name}
                </span>{" "}
                and created as a new{" "}
                <span className="font-medium text-foreground">
                  {name.trim() === "" ? "budget" : name.trim()}
                </span>{" "}
                allotment.
              </p>
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
                <dt className="text-muted-strong">
                  {asTransfer ? "Transfer amount" : "Expense"}
                </dt>
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
