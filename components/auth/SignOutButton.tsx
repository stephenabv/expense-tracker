"use client";

import { signOutAction } from "@/lib/server/auth-actions";
import { SubmitButton } from "@/components/auth/SubmitButton";

/**
 * Logout.
 *
 * A POST via a server action, not a link — signing out should not be reachable
 * by a prefetch or a stray GET.
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <SubmitButton pendingLabel="Logging out…" className={className ?? "w-full"}>
        Log out
      </SubmitButton>
    </form>
  );
}
