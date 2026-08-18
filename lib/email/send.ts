/**
 * Email delivery.
 *
 * Resend is used when `RESEND_API_KEY` is present. Without it the message is
 * logged to the server console instead, so the whole flow — including the link
 * — is exercisable in development without an account. The link is a
 * capability, so the fallback only ever writes it to the server log, never to
 * the browser or to a response.
 */

import type { EmailContent } from "@/lib/email/templates";

export interface SendResult {
  ok: boolean;
  /** Which transport handled it, for logging and tests. */
  transport: "resend" | "console";
  error?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(
  to: string,
  content: EmailContent,
): Promise<SendResult> {
  if (!isEmailConfigured()) {
    // Development fallback. Deliberately server-side only.
    console.info(
      [
        "",
        "──────────── Expense Tracker email (no provider configured) ────────────",
        `To:      ${to}`,
        `Subject: ${content.subject}`,
        "",
        content.text,
        "────────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { ok: true, transport: "console" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });

    if (error) {
      // The message is logged, never the token-bearing URL.
      console.error("Email delivery failed:", error.message);
      return { ok: false, transport: "resend", error: error.message };
    }

    return { ok: true, transport: "resend" };
  } catch (error) {
    console.error(
      "Email delivery threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false, transport: "resend", error: "delivery_failed" };
  }
}

/** Absolute base URL for links in emails. */
export function appBaseUrl(): string {
  const configured = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}
