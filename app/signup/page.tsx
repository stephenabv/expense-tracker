import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = { title: "Create account · Expense Tracker" };

export default function SignUpPage() {
  return <SignUpForm />;
}
