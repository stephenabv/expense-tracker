import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "./support/db";
import {
  authenticate,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmailToken,
} from "@/lib/auth/service";
import { findUserByEmail, findUserCredentials } from "@/lib/db/users";
import { verifyPassword } from "@/lib/auth/password";

let db: TestDatabase;
/** Captures the links the emails would carry, the way a user's inbox would. */
let sentLinks: string[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  // The console transport prints the link; capture it instead of printing.
  vi.spyOn(console, "info").mockImplementation((message?: unknown) => {
    const text = String(message ?? "");
    const match = /https?:\/\/\S+/.exec(text);
    if (match) sentLinks.push(match[0]);
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.close();
});

beforeEach(async () => {
  await db.reset();
  sentLinks = [];
});

const VALID = {
  name: "Juan Dela Cruz",
  gender: "prefer_not_to_say" as const,
  email: "juan@example.com",
  password: "Password123!",
};

function tokenFrom(link: string): string {
  return new URL(link).searchParams.get("token")!;
}

describe("registration", () => {
  it("creates an unverified account and sends a link", async () => {
    const result = await registerUser(VALID);
    expect(result.ok).toBe(true);

    const user = await findUserByEmail(VALID.email);
    expect(user?.emailVerifiedAt).toBeNull();
    expect(sentLinks).toHaveLength(1);
    expect(sentLinks[0]).toContain("/verify-email?token=");
  });

  it("stores the password as an argon2id hash, never in the clear", async () => {
    await registerUser(VALID);
    const credentials = await findUserCredentials(VALID.email);

    expect(credentials!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credentials!.passwordHash).not.toContain(VALID.password);
    expect(await verifyPassword(credentials!.passwordHash, VALID.password)).toBe(true);
  });

  it("reports a duplicate email rather than creating a second account", async () => {
    await registerUser(VALID);
    const second = await registerUser(VALID);
    expect(second).toEqual({ ok: false, reason: "email_taken" });
  });
});

describe("login gating", () => {
  it("refuses an unverified account even with the right password", async () => {
    await registerUser(VALID);
    const result = await authenticate(VALID.email, VALID.password);
    expect(result).toEqual({ ok: false, reason: "unverified" });
  });

  it("succeeds once the email is verified", async () => {
    await registerUser(VALID);
    await verifyEmailToken(tokenFrom(sentLinks[0]));

    const result = await authenticate(VALID.email, VALID.password);
    expect(result.ok).toBe(true);
  });

  it("never returns the password hash to the caller", async () => {
    await registerUser(VALID);
    await verifyEmailToken(tokenFrom(sentLinks[0]));

    const result = await authenticate(VALID.email, VALID.password);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("rejects a wrong password without revealing the account exists", async () => {
    await registerUser(VALID);
    await verifyEmailToken(tokenFrom(sentLinks[0]));

    expect(await authenticate(VALID.email, "Wrong123!")).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("gives an unknown address the same answer as a wrong password", async () => {
    expect(await authenticate("nobody@example.com", "Password123!")).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });
});

describe("email verification", () => {
  it("accepts a valid token once and refuses the replay", async () => {
    await registerUser(VALID);
    const token = tokenFrom(sentLinks[0]);

    expect(await verifyEmailToken(token)).toEqual({ ok: true, alreadyVerified: false });
    expect(await verifyEmailToken(token)).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
  });

  it("refuses an unknown token", async () => {
    expect(await verifyEmailToken("made-up-token")).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
  });

  it("retires the previous link when a new one is issued", async () => {
    await registerUser(VALID);
    const first = tokenFrom(sentLinks[0]);

    await resendVerification(VALID.email);
    const second = tokenFrom(sentLinks[1]);
    expect(second).not.toBe(first);

    expect(await verifyEmailToken(first)).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    expect((await verifyEmailToken(second)).ok).toBe(true);
  });

  it("says nothing about an unknown address on resend", async () => {
    expect(await resendVerification("nobody@example.com")).toEqual({ ok: true });
    expect(sentLinks).toHaveLength(0);
  });

  it("does not resend to an already-verified account", async () => {
    await registerUser(VALID);
    await verifyEmailToken(tokenFrom(sentLinks[0]));
    sentLinks = [];

    expect(await resendVerification(VALID.email)).toEqual({ ok: true });
    expect(sentLinks).toHaveLength(0);
  });
});

describe("password reset", () => {
  async function verifiedUser() {
    await registerUser(VALID);
    await verifyEmailToken(tokenFrom(sentLinks[0]));
    sentLinks = [];
  }

  it("sends a reset link to a verified account", async () => {
    await verifiedUser();
    expect(await requestPasswordReset(VALID.email)).toEqual({ outcome: "sent" });
    expect(sentLinks[0]).toContain("/reset-password?token=");
  });

  it("refuses to reset an unverified account and nudges verification instead", async () => {
    await registerUser(VALID);
    sentLinks = [];

    expect(await requestPasswordReset(VALID.email)).toEqual({ outcome: "unverified" });
    // The mail that goes out is a verification link, never a reset link.
    expect(sentLinks[0]).toContain("/verify-email?token=");
    expect(sentLinks.some((link) => link.includes("/reset-password"))).toBe(false);
  });

  it("sends nothing for an unknown address", async () => {
    expect(await requestPasswordReset("nobody@example.com")).toEqual({
      outcome: "no_account",
    });
    expect(sentLinks).toHaveLength(0);
  });

  it("changes the password and lets the new one log in", async () => {
    await verifiedUser();
    await requestPasswordReset(VALID.email);
    const token = tokenFrom(sentLinks[0]);

    expect(await resetPassword(token, "BrandNew456?")).toEqual({ ok: true });

    expect((await authenticate(VALID.email, "BrandNew456?")).ok).toBe(true);
    expect(await authenticate(VALID.email, VALID.password)).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("refuses to reuse a reset token", async () => {
    await verifiedUser();
    await requestPasswordReset(VALID.email);
    const token = tokenFrom(sentLinks[0]);

    await resetPassword(token, "BrandNew456?");
    expect(await resetPassword(token, "Another789$")).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
  });

  it("retires an older reset link when a new one is requested", async () => {
    await verifiedUser();
    await requestPasswordReset(VALID.email);
    const first = tokenFrom(sentLinks[0]);

    await requestPasswordReset(VALID.email);
    const second = tokenFrom(sentLinks[1]);

    expect(await resetPassword(first, "BrandNew456?")).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    expect(await resetPassword(second, "BrandNew456?")).toEqual({ ok: true });
  });

  it("refuses an unknown reset token", async () => {
    expect(await resetPassword("nope", "BrandNew456?")).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
  });

  it("does not accept a verification token as a reset token", async () => {
    await registerUser(VALID);
    const verificationToken = tokenFrom(sentLinks[0]);

    expect(await resetPassword(verificationToken, "BrandNew456?")).toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
  });
});
