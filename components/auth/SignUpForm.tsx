"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/FormMessage";
import { PasswordChecklist } from "@/components/auth/PasswordChecklist";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { SelectField } from "@/components/ui/SelectField";
import { GENDERS, GENDER_LABELS, NAME_MAX } from "@/lib/auth/schemas";
import { signUpAction, type ActionState } from "@/lib/server/auth-actions";

const INITIAL: ActionState = {};

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, INITIAL);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");

  if (state.ok) {
    return (
      <AuthShell
        title="Account created"
        subtitle="One more step before you can log in."
      >
        <FormMessage tone="success">
          We&apos;ve sent a verification link to{" "}
          <strong className="font-semibold">{email || "your email address"}</strong>.
          Please verify your email before logging in.
        </FormMessage>

        <div className="mt-5 space-y-3">
          <Link
            href={`/verify-email?email=${encodeURIComponent(email)}`}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-border-subtle bg-surface text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Resend verification email
          </Link>
          <Link
            href="/login"
            className="flex h-11 w-full items-center justify-center rounded-xl bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Go to login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Track budgets and expenses in Philippine Peso."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4" noValidate>
        {state.message ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}

        <TextField
          label="Name"
          name="name"
          placeholder="Juan Dela Cruz"
          autoComplete="name"
          maxLength={NAME_MAX}
          required
          error={state.errors?.name}
        />

        <SelectField
          label="Gender"
          name="gender"
          defaultValue=""
          required
          error={state.errors?.gender}
        >
          <option value="" disabled>
            Select gender
          </option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {GENDER_LABELS[gender]}
            </option>
          ))}
        </SelectField>

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

        <SubmitButton pendingLabel="Creating account…">Create Account</SubmitButton>
      </form>
    </AuthShell>
  );
}
