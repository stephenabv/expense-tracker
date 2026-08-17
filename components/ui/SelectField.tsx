"use client";

import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
}

/** Labelled native select, wired for accessible error reporting. */
export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted-strong">
        {label}
      </label>

      <div
        className={cn(
          "relative flex items-center rounded-xl border bg-surface transition-colors duration-150",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          error ? "border-danger" : "border-border-subtle hover:border-border-strong",
        )}
      >
        <select
          id={id}
          data-focus-ring="none"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "h-12 w-full min-w-0 appearance-none rounded-xl bg-transparent pl-3.5 pr-10",
            "text-base text-foreground focus:outline-none focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-70",
            className,
          )}
          {...props}
        >
          {children}
        </select>

        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute right-3.5 h-4 w-4 text-muted"
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
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
}
