"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/FormMessage";
import { PasswordChecklist } from "@/components/auth/PasswordChecklist";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import {
  resetPasswordAction,
  type ActionState,
} from "@/lib/server/auth-actions";

const INITIAL: ActionState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, INITIAL);
  const [password, setPassword] = useState("");

  if (state.ok) {
    return (
      <AuthShell title="Password updated" subtitle="You can now log in.">
        <FormMessage tone="success">
          Your password has been changed and any outstanding reset links have been
          cancelled. Please log in with your new password.
        </FormMessage>
        <Link
          href="/login"
          className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Go to login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset password"
      subtitle="Choose a new password for your account."
      footer={
        <Link
          href="/forgot-password"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Request a new link
        </Link>
      }
    >
      <form action={action} className="space-y-4" noValidate>
        {state.message ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}

        {/* The token travels with the form rather than being re-read from the
            URL on submit, so a stale address bar cannot redeem a different one. */}
        <input type="hidden" name="token" value={token} />

        <TextField
          label="New Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={state.errors?.password}
        />

        <PasswordChecklist password={password} />

        <TextField
          label="Confirm Password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={state.errors?.confirmPassword}
        />

        <SubmitButton pendingLabel="Updating…">Reset Password</SubmitButton>
      </form>
    </AuthShell>
  );
}
