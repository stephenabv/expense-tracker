"use client";

import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface DateFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  label: string;
  invalid?: boolean;
}

/**
 * Native date input with a real label.
 *
 * Uses `type="date"` deliberately: it brings the platform's own picker and
 * keyboard handling on every device, which no custom calendar matches for
 * accessibility.
 */
export function DateField({
  label,
  invalid,
  className,
  ...props
}: DateFieldProps) {
  const id = useId();

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted-strong">
        {label}
      </label>

      <input
        id={id}
        type="date"
        data-focus-ring="none"
        aria-invalid={invalid ? true : undefined}
        className={cn(
          "h-11 w-full min-w-0 rounded-xl border bg-surface px-3 text-base text-foreground",
          "transition-colors duration-150",
          "focus:outline-none focus-visible:outline-none",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          invalid
            ? "border-danger"
            : "border-border-subtle hover:border-border-strong",
          className,
        )}
        {...props}
      />
    </div>
  );
}
