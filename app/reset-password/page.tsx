import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/FormMessage";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Reset password · Expense Tracker" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // The token is only checked when the new password is submitted. Verifying it
  // on load would consume a single-use token just because someone opened the
  // page, leaving them unable to finish.
  if (!token) {
    return (
      <AuthShell title="Reset password" subtitle="This link is incomplete.">
        <FormMessage tone="error">
          This password reset link is missing its token. Request a new one to
          continue.
        </FormMessage>
        <Link
          href="/forgot-password"
          className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return <ResetPasswordForm token={token} />;
}
