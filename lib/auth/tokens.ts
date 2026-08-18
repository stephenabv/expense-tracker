/**
 * Verification and password-reset tokens.
 *
 * The raw token is generated from the CSPRNG and handed to the email exactly
 * once. Only its SHA-256 hash is stored, so reading the database does not let
 * anyone verify an address or take over an account.
 *
 * Tokens are single-use and time-limited; both are enforced in SQL when the
 * token is redeemed, not merely checked in application code.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of entropy — not a counter, a user id, or a timestamp. */
const TOKEN_BYTES = 32;

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface IssuedToken {
  /** Sent to the user. Never stored. */
  token: string;
  /** Stored in place of the token. */
  tokenHash: string;
  expiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createToken(ttlMs: number, now: Date = new Date()): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export const createVerificationToken = (now?: Date) =>
  createToken(VERIFICATION_TOKEN_TTL_MS, now);

export const createResetToken = (now?: Date) =>
  createToken(RESET_TOKEN_TTL_MS, now);

/** Constant-time comparison, for the rare case two hashes are compared directly. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** True when a token row can still be redeemed. */
export function isTokenUsable(
  row: { expiresAt: Date | string; consumedAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (row.consumedAt) return false;
  const expires = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
}
