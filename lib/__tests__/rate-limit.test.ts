import { beforeEach, describe, expect, it } from "vitest";

import {
  RATE_LIMITS,
  consume,
  rateLimitMessage,
  resetRateLimits,
} from "@/lib/server/rate-limit";

beforeEach(() => resetRateLimits());

describe("consume", () => {
  it("allows attempts up to the limit and then refuses", () => {
    const { limit } = RATE_LIMITS.signIn;

    for (let i = 0; i < limit; i += 1) {
      expect(consume("signIn", "1.2.3.4").ok, `attempt ${i + 1}`).toBe(true);
    }
    expect(consume("signIn", "1.2.3.4").ok).toBe(false);
  });

  it("counts each key separately", () => {
    const { limit } = RATE_LIMITS.forgotPassword;
    for (let i = 0; i < limit; i += 1) consume("forgotPassword", "a");

    expect(consume("forgotPassword", "a").ok).toBe(false);
    expect(consume("forgotPassword", "b").ok).toBe(true);
  });

  it("counts each action separately", () => {
    const { limit } = RATE_LIMITS.resendVerification;
    for (let i = 0; i < limit; i += 1) consume("resendVerification", "ip");

    expect(consume("resendVerification", "ip").ok).toBe(false);
    expect(consume("signIn", "ip").ok).toBe(true);
  });

  it("reopens once the window has passed", () => {
    const start = 1_000_000;
    const { limit, windowMs } = RATE_LIMITS.signUp;

    for (let i = 0; i < limit; i += 1) consume("signUp", "ip", start);
    expect(consume("signUp", "ip", start).ok).toBe(false);

    expect(consume("signUp", "ip", start + windowMs + 1).ok).toBe(true);
  });

  it("reports how long to wait", () => {
    const start = 1_000_000;
    const { limit } = RATE_LIMITS.signIn;
    for (let i = 0; i < limit; i += 1) consume("signIn", "ip", start);

    const blocked = consume("signIn", "ip", start);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps the mail-sending limits tight enough to stop flooding", () => {
    expect(RATE_LIMITS.resendVerification.limit).toBeLessThanOrEqual(5);
    expect(RATE_LIMITS.forgotPassword.limit).toBeLessThanOrEqual(5);
  });

  it("covers every security-sensitive action named in the product rules", () => {
    for (const action of [
      "signUp",
      "signIn",
      "verifyEmail",
      "resendVerification",
      "forgotPassword",
      "resetPassword",
    ] as const) {
      expect(RATE_LIMITS[action].limit).toBeGreaterThan(0);
      expect(RATE_LIMITS[action].windowMs).toBeGreaterThan(0);
    }
  });
});

describe("rateLimitMessage", () => {
  it("does not disclose which limit was hit", () => {
    const message = rateLimitMessage({
      ok: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });
    expect(message).toMatch(/Too many attempts/);
    expect(message).not.toMatch(/login|email|password/i);
  });
});
