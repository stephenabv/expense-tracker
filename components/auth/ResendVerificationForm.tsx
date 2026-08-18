"use client";

import { useActionState } from "react";
import Link from "next/link";

import { FormMessage } from "@/components/auth/FormMessage";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import {
  resendVerificationAction,
  type ActionState,
} from "@/lib/server/auth-actions";

const INITIAL: ActionState = {};

/** Requests another verification link. The response never confirms the address. */
export function ResendVerificationForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, action] = useActionState(resendVerificationAction, INITIAL);

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message ? (
        <FormMessage tone={state.ok ? "success" : "error"}>
          {state.message}
        </FormMessage>
      ) : null}

      <TextField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        placeholder="juan@example.com"
        autoComplete="email"
        defaultValue={defaultEmail}
        required
        error={state.errors?.email}
      />

      <SubmitButton pendingLabel="Sending…">Resend verification email</SubmitButton>

      <p className="text-center text-sm">
        <Link
          href="/login"
          className="text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to login
        </Link>
      </p>
    </form>
  );
}
