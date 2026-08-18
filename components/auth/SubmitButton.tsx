"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";

/** Submit control that disables itself while the action is in flight. */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className ?? "w-full"}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
