import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/FormMessage";
import { ResendVerificationForm } from "@/components/auth/ResendVerificationForm";
import { verifyEmailAction } from "@/lib/server/auth-actions";

export const metadata: Metadata = { title: "Verify email · Expense Tracker" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  // With a token this page *is* the verification step; without one it is the
  // place to ask for another link.
  if (token) {
    const result = await verifyEmailAction(token);

    if (result.ok) {
      return (
        <AuthShell
          title="Email verified"
          subtitle="Your account is now active."
        >
          <FormMessage tone="success">
            Thanks — your email address has been verified. You can log in now.
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
        title="Link expired"
        subtitle="Request a fresh verification email below."
      >
        <FormMessage tone="error">{result.message}</FormMessage>
        <div className="mt-5">
          <ResendVerificationForm defaultEmail={email} />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle="Enter your address and we'll send the link again."
    >
      <ResendVerificationForm defaultEmail={email} />
    </AuthShell>
  );
}
