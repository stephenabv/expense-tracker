import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appBaseUrl,
  isEmailConfigured,
  sendEmail,
  smtpConfig,
  transportOptions,
} from "@/lib/email/send";
import { verificationEmail } from "@/lib/email/templates";

const SMTP_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "EMAIL_FROM",
  "APP_URL",
  "NEXTAUTH_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

const saved: Record<string, string | undefined> = {};

function configure(overrides: Record<string, string | undefined> = {}) {
  const settings: Record<string, string | undefined> = {
    SMTP_HOST: "smtp-relay.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "mailer@example.com",
    SMTP_PASSWORD: "a-secret-key",
    EMAIL_FROM: "Expense Tracker <no-reply@example.com>",
    ...overrides,
  };
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  for (const key of SMTP_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of SMTP_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("smtp configuration", () => {
  it("is unconfigured until every setting is present", () => {
    expect(isEmailConfigured()).toBe(false);

    for (const missing of [
      "SMTP_HOST",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "EMAIL_FROM",
    ]) {
      configure({ [missing]: undefined });
      expect(isEmailConfigured(), `${missing} missing`).toBe(false);
    }

    configure();
    expect(isEmailConfigured()).toBe(true);
  });

  it("treats a blank setting as absent", () => {
    configure({ SMTP_USER: "   " });
    expect(isEmailConfigured()).toBe(false);
  });

  it("defaults the port to the submission port", () => {
    configure({ SMTP_PORT: undefined });
    expect(smtpConfig()?.port).toBe(587);
  });

  it("falls back to the submission port when the port is nonsense", () => {
    configure({ SMTP_PORT: "not-a-port" });
    expect(smtpConfig()?.port).toBe(587);

    configure({ SMTP_PORT: "0" });
    expect(smtpConfig()?.port).toBe(587);
  });

  it("reads a custom port", () => {
    configure({ SMTP_PORT: "465" });
    expect(smtpConfig()?.port).toBe(465);
  });
});

describe("transport options", () => {
  it("requires STARTTLS on the submission port", () => {
    configure({ SMTP_PORT: "587" });
    const options = transportOptions(smtpConfig()!);

    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });

  it("uses implicit TLS on 465", () => {
    configure({ SMTP_PORT: "465" });
    const options = transportOptions(smtpConfig()!);

    expect(options.secure).toBe(true);
  });

  it("never leaves a connection without a timeout", () => {
    configure();
    const options = transportOptions(smtpConfig()!);

    expect(options.connectionTimeout).toBeGreaterThan(0);
    expect(options.greetingTimeout).toBeGreaterThan(0);
    expect(options.socketTimeout).toBeGreaterThan(0);
  });
});

describe("sendEmail", () => {
  const content = verificationEmail("https://example.com/verify-email?token=abc");

  it("logs to the console when no relay is configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendEmail("someone@example.com", content);

    expect(result).toEqual({ ok: true, transport: "console" });
    // The link has to reach the developer somehow; the server log is the only
    // place it is allowed to appear.
    expect(info.mock.calls[0][0]).toContain("token=abc");
  });

  it("reports a generic failure and leaks nothing when the relay is unreachable", async () => {
    // Port 1 on the loopback interface refuses the connection immediately.
    configure({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "1" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendEmail("someone@example.com", content);

    expect(result.ok).toBe(false);
    expect(result.transport).toBe("smtp");
    // Callers see a fixed string, so nothing about the relay reaches the UI.
    expect(result.error).toBe("delivery_failed");

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).not.toContain("token=abc");
    expect(logged).not.toContain("a-secret-key");
  });
});

describe("appBaseUrl", () => {
  it("prefers APP_URL and drops a trailing slash", () => {
    process.env.APP_URL = "https://tracker.example.com/";
    expect(appBaseUrl()).toBe("https://tracker.example.com");
  });

  it("falls back to the Vercel deployment URL", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "tracker.vercel.app";
    expect(appBaseUrl()).toBe("https://tracker.vercel.app");
  });

  it("falls back to localhost", () => {
    expect(appBaseUrl()).toBe("http://localhost:3000");
  });
});
