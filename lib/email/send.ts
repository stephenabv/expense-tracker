/**
 * Email delivery over SMTP.
 *
 * Any SMTP relay works — the app was wired against Brevo
 * (`smtp-relay.brevo.com:587`). When the SMTP variables are absent the message
 * is logged to the server console instead, so the whole flow — including the
 * link — is exercisable in development without an account.
 *
 * The link inside these messages is a capability: it is only ever written to
 * the SMTP conversation or to the server log, never to the browser, a response
 * body, or an error message.
 */

import type { Transporter } from "nodemailer";

import type { EmailContent } from "@/lib/email/templates";

export interface SendResult {
  ok: boolean;
  /** Which transport handled it, for logging and tests. */
  transport: "smtp" | "console";
  error?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

const DEFAULT_PORT = 587;

/**
 * Reads the SMTP settings, or returns null when the relay is not configured.
 * Returning the whole set at once keeps `isEmailConfigured` and `sendEmail`
 * from disagreeing about what "configured" means.
 */
export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.EMAIL_FROM?.trim();
  if (!host || !user || !password || !from) return null;

  const port = Number(process.env.SMTP_PORT ?? DEFAULT_PORT);
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
    user,
    password,
    from,
  };
}

export function isEmailConfigured(): boolean {
  return smtpConfig() !== null;
}

/**
 * Connection settings for a relay.
 *
 * Port 465 is implicit TLS; every other port opens in the clear, so STARTTLS is
 * *required* rather than merely attempted — a relay that does not offer it gets
 * neither the credentials nor the message.
 */
export function transportOptions(config: SmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: 1,
    // A hung relay must not hold a server action open indefinitely.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/*
 * One pooled transporter per server process.
 *
 * Next bundles this module into several server chunks, so a plain
 * module-level variable would produce a separate connection pool per chunk.
 * The cache key includes the settings so a changed relay is picked up rather
 * than silently reusing the old connection.
 */
interface TransportCache {
  key: string;
  transporter: Transporter;
}

const globalCache = globalThis as typeof globalThis & {
  __expenseTrackerMailer?: TransportCache;
};

async function getTransporter(config: SmtpConfig): Promise<Transporter> {
  const key = `${config.host}:${config.port}:${config.user}`;
  const cached = globalCache.__expenseTrackerMailer;
  if (cached?.key === key) return cached.transporter;

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport(transportOptions(config));

  cached?.transporter.close();
  globalCache.__expenseTrackerMailer = { key, transporter };
  return transporter;
}

export async function sendEmail(
  to: string,
  content: EmailContent,
): Promise<SendResult> {
  const config = smtpConfig();

  if (!config) {
    // Development fallback. Deliberately server-side only.
    console.info(
      [
        "",
        "──────────── Expense Tracker email (no SMTP relay configured) ────────────",
        `To:      ${to}`,
        `Subject: ${content.subject}`,
        "",
        content.text,
        "──────────────────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { ok: true, transport: "console" };
  }

  try {
    const transporter = await getTransporter(config);
    await transporter.sendMail({
      from: config.from,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    return { ok: true, transport: "smtp" };
  } catch (error) {
    // The reason is logged, never the token-bearing URL or the SMTP key.
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Email delivery failed:", message);
    return { ok: false, transport: "smtp", error: "delivery_failed" };
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
