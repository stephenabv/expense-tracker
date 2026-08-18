"use client";

import { useActionState } from "react";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/FormMessage";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import {
  forgotPasswordAction,
  type ActionState,
} from "@/lib/server/auth-actions";

const INITIAL: ActionState = {};

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, INITIAL);

  return (
    <AuthShell
      title="Forgot password?"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to login
        </Link>
      }
    >
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
          required
          error={state.errors?.email}
        />

        <SubmitButton pendingLabel="Sending…">Send Reset Link</SubmitButton>
      </form>
    </AuthShell>
  );
}
