"use client";

import { PASSWORD_RULE_LABELS, checkPassword } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

/**
 * Live feedback on the password rules.
 *
 * Shows only whether each rule is met — the password itself is never echoed,
 * stored, or sent anywhere by this component.
 */
export function PasswordChecklist({ password }: { password: string }) {
  const checks = checkPassword(password);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-muted p-3.5">
      <p className="text-[0.8125rem] font-medium text-muted-strong">
        Password requirements
      </p>
      <ul className="mt-2 space-y-1">
        {PASSWORD_RULE_LABELS.map(({ key, label }) => {
          const met = checks[key];
          return (
            <li
              key={key}
              className={cn(
                "flex items-center gap-2 text-[0.8125rem]",
                met ? "text-positive" : "text-muted",
              )}
            >
              <span aria-hidden="true" className="w-3.5 shrink-0 text-center">
                {met ? "✓" : "○"}
              </span>
              <span>{label}</span>
              <span className="sr-only">{met ? " — met" : " — not met yet"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
