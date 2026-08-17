"use client";

import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";

export interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
}

/** Create flow. Thin wrapper so the two entry points read clearly at call sites. */
export function AddExpenseModal({ open, onClose }: AddExpenseModalProps) {
  return <ExpenseFormModal open={open} onClose={onClose} />;
}
