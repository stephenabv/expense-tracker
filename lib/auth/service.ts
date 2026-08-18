/**
 * The authentication flows.
 *
 * Framework-free on purpose: server actions and the Auth.js callback both call
 * into here, and the tests drive these functions directly against a real
 * database. Every rule the product depends on — verification gating, token
 * lifetimes, enumeration resistance — lives here rather than in a form.
 */

import { getDatabase, type SqlExecutor } from "@/lib/db/client";
import {
  EmailAlreadyRegisteredError,
  createUser,
  findUserByEmail,
  findUserCredentials,
  isVerified,
  markEmailVerified,
  updatePasswordHash,
  type PublicUser,
} from "@/lib/db/users";
import {
  consumeAllTokens,
  redeemToken,
  storeToken,
} from "@/lib/db/tokens";
import { createResetToken, createVerificationToken } from "@/lib/auth/tokens";
import { fakeVerify, hashPassword, verifyPassword } from "@/lib/auth/password";
import { appBaseUrl, sendEmail } from "@/lib/email/send";
import { passwordResetEmail, verificationEmail } from "@/lib/email/templates";
import type { Gender } from "@/lib/auth/schemas";

export interface RegisterInput {
  name: string;
  gender: Gender;
  email: string;
  password: string;
}

/** Issues a fresh verification link, retiring any earlier one. */
export async function issueVerificationEmail(
  user: PublicUser,
  db: SqlExecutor = getDatabase(),
): Promise<void> {
  // A newly requested link supersedes the old one, so a leaked earlier email
  // stops working the moment a replacement is sent.
  await consumeAllTokens("verification", user.id, db);

  const issued = createVerificationToken();
  await storeToken("verification", user.id, issued.tokenHash, issued.expiresAt, db);

  const url = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(issued.token)}`;
  await sendEmail(user.email, verificationEmail(url));
}

export type RegisterResult =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: "email_taken" };

/**
 * Creates an account in the unverified state and sends the first link.
 *
 * The duplicate-email case is reported to the caller so the sign-up form can
 * say so plainly — the address is one the person just typed, and the sign-in
 * form would reveal the same thing. Enumeration resistance matters on the
 * flows where the address is *not* already known to the requester.
 */
export async function registerUser(
  input: RegisterInput,
  db: SqlExecutor = getDatabase(),
): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await createUser(
      {
        name: input.name,
        gender: input.gender,
        email: input.email,
        passwordHash,
      },
      db,
    );

    await issueVerificationEmail(user, db);
    return { ok: true, user };
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return { ok: false, reason: "email_taken" };
    }
    throw error;
  }
}

export type AuthenticateResult =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: "invalid_credentials" | "unverified" };

/**
 * Checks an email and password.
 *
 * An unknown address still pays for a hash comparison, so the response time
 * cannot be used to tell registered addresses from unregistered ones.
 *
 * An unverified account is reported separately because the product needs to
 * offer "resend verification" — but only *after* the password was correct, so
 * the distinction is never available to someone guessing.
 */
export async function authenticate(
  email: string,
  password: string,
  db: SqlExecutor = getDatabase(),
): Promise<AuthenticateResult> {
  const credentials = await findUserCredentials(email, db);

  if (!credentials) {
    await fakeVerify();
    return { ok: false, reason: "invalid_credentials" };
  }

  const passwordOk = await verifyPassword(credentials.passwordHash, password);
  if (!passwordOk) return { ok: false, reason: "invalid_credentials" };

  if (!isVerified(credentials)) return { ok: false, reason: "unverified" };

  // Strip the hash before the record travels any further.
  const user: PublicUser = {
    id: credentials.id,
    name: credentials.name,
    gender: credentials.gender,
    email: credentials.email,
    emailVerifiedAt: credentials.emailVerifiedAt,
    createdAt: credentials.createdAt,
  };
  return { ok: true, user };
}

export type VerifyEmailResult =
  | { ok: true; alreadyVerified: boolean }
  | { ok: false; reason: "invalid_or_expired" };

/** Redeems a verification token. Single-use and time-limited, enforced in SQL. */
export async function verifyEmailToken(
  token: string,
  db: SqlExecutor = getDatabase(),
): Promise<VerifyEmailResult> {
  const userId = await redeemToken("verification", token, db);
  if (!userId) return { ok: false, reason: "invalid_or_expired" };

  const { rows } = await db.query<{ email_verified_at: Date | string | null }>(
    "SELECT email_verified_at FROM users WHERE id = $1",
    [userId],
  );
  const alreadyVerified = Boolean(rows[0]?.email_verified_at);

  await markEmailVerified(userId, db);
  return { ok: true, alreadyVerified };
}

/**
 * Sends another verification link.
 *
 * Always reports success to the caller: telling an anonymous requester that an
 * address is unknown, or already verified, would turn this into an account
 * oracle.
 */
export async function resendVerification(
  email: string,
  db: SqlExecutor = getDatabase(),
): Promise<{ ok: true }> {
  const user = await findUserByEmail(email, db);
  if (user && !isVerified(user)) {
    await issueVerificationEmail(user, db);
  }
  return { ok: true };
}

export type ForgotPasswordOutcome = "sent" | "unverified" | "no_account";

/**
 * Starts a password reset.
 *
 * An unverified account is refused: allowing a reset would let whoever
 * registered an address they do not control take it over by way of the reset
 * flow, bypassing verification entirely.
 *
 * The outcome is returned for tests and logging; the server action collapses it
 * into one generic response so the page cannot be used to enumerate accounts.
 */
export async function requestPasswordReset(
  email: string,
  db: SqlExecutor = getDatabase(),
): Promise<{ outcome: ForgotPasswordOutcome }> {
  const user = await findUserByEmail(email, db);
  if (!user) return { outcome: "no_account" };

  if (!isVerified(user)) {
    // Nudge them down the verification path instead, without a reset link.
    await issueVerificationEmail(user, db);
    return { outcome: "unverified" };
  }

  await consumeAllTokens("reset", user.id, db);

  const issued = createResetToken();
  await storeToken("reset", user.id, issued.tokenHash, issued.expiresAt, db);

  const url = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(issued.token)}`;
  await sendEmail(user.email, passwordResetEmail(url));

  return { outcome: "sent" };
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid_or_expired" };

/**
 * Completes a password reset.
 *
 * The token is redeemed atomically, the password is replaced, and every other
 * outstanding reset link for the account is retired. Sessions are stateless
 * JWTs, so the user is signed out client-side and must log in again.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  db: SqlExecutor = getDatabase(),
): Promise<ResetPasswordResult> {
  const userId = await redeemToken("reset", token, db);
  if (!userId) return { ok: false, reason: "invalid_or_expired" };

  const passwordHash = await hashPassword(newPassword);
  await updatePasswordHash(userId, passwordHash, db);
  await consumeAllTokens("reset", userId, db);

  return { ok: true };
}
