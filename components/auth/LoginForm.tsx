"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/FormMessage";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { signInAction, type ActionState } from "@/lib/server/auth-actions";

const INITIAL: ActionState = {};

export function LoginForm() {
  const [state, action] = useActionState(signInAction, INITIAL);
  const [email, setEmail] = useState("");

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to reach your budgets."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4" noValidate>
        {state.message ? (
          <FormMessage tone={state.unverifiedEmail ? "info" : "error"}>
            <p>{state.message}</p>
            {state.unverifiedEmail ? (
              <Link
                href={`/verify-email?email=${encodeURIComponent(state.unverifiedEmail)}`}
                className="mt-2 inline-flex font-medium text-foreground underline underline-offset-4"
              >
                Resend verification email
              </Link>
            ) : null}
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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={state.errors?.email}
        />

        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state.errors?.password}
        />

        <SubmitButton pendingLabel="Logging in…">Login</SubmitButton>

        <p className="text-center text-sm">
          <Link
            href="/forgot-password"
            className="text-muted underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
