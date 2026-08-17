"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  /** Helper text shown when there is no error. */
  hint?: ReactNode;
  /** Rendered inside the field, e.g. the peso sign. */
  prefix?: string;
}

/**
 * Labelled text input with accessible error wiring.
 *
 * The label is always a real `<label>` (never a placeholder), and errors are
 * announced through `aria-describedby` + `role="alert"`.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, error, hint, prefix, className, ...props }, ref) {
    const id = useId();
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={id}
          className="text-sm font-medium text-muted-strong"
        >
          {label}
        </label>

        <div
          className={cn(
            "flex items-center rounded-xl border bg-surface transition-colors duration-150",
            "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
            error
              ? "border-danger"
              : "border-border-subtle hover:border-border-strong",
          )}
        >
          {prefix ? (
            <span
              aria-hidden="true"
              className="pl-3.5 pr-1 text-base text-muted select-none"
            >
              {prefix}
            </span>
          ) : null}

          <input
            ref={ref}
            id={id}
            data-focus-ring="none"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              "h-12 w-full min-w-0 rounded-xl bg-transparent text-base text-foreground",
              // The wrapper renders the focus ring, so the input suppresses its own.
              "placeholder:text-muted/70 focus:outline-none focus-visible:outline-none",
              prefix ? "pl-0 pr-3.5" : "px-3.5",
              className,
            )}
            {...props}
          />
        </div>

        {error ? (
          <p id={errorId} role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
