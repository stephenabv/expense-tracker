"use server";

/**
 * Authentication server actions.
 *
 * This is the trust boundary. Everything arriving here is untrusted: each
 * action re-parses its input with the shared schema, applies rate limiting, and
 * only then calls the service layer. The client's own validation is a
 * convenience and is never relied upon.
 */

import { isRedirectError } from "next/dist/client/components/redirect-error";

import { signIn, signOut } from "@/auth";
import {
  emailOnlySchema,
  fieldErrors,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import {
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmailToken,
} from "@/lib/auth/service";
import { consume, rateLimitMessage } from "@/lib/server/rate-limit";
import { clientIp } from "@/lib/server/request";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/auth/routes";
import { isDatabaseConfigured } from "@/lib/db/client";

export interface ActionState {
  ok?: boolean;
  /** Shown above the form. */
  message?: string;
  /** Keyed by field name. */
  errors?: Record<string, string>;
  /** Lets the login page offer "resend verification". */
  unverifiedEmail?: string;
}

const SETUP_REQUIRED: ActionState = {
  ok: false,
  message:
    "The server is not connected to a database yet. Set DATABASE_URL to continue.",
};

function readString(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

/* ----------------------------------------------------------------- sign up */

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isDatabaseConfigured()) return SETUP_REQUIRED;

  const parsed = signUpSchema.safeParse({
    name: readString(formData, "name"),
    gender: readString(formData, "gender"),
    email: readString(formData, "email"),
    password: readString(formData, "password"),
    confirmPassword: readString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  const limit = consume("signUp", await clientIp());
  if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };

  const result = await registerUser(parsed.data);

  if (!result.ok) {
    /*
     * Registration is the one flow that may name the clash.
     *
     * The person typed this address themselves and needs to know why the form
     * refused; any vaguer wording would just strand them. Login, forgot-password
     * and resend-verification stay deliberately silent about whether an account
     * exists — see their generic messages — so this does not become a way to
     * probe for addresses through those endpoints.
     */
    return {
      ok: false,
      errors: {
        email:
          "An account with this email already exists. Try logging in instead, or use Forgot password if you no longer have it.",
      },
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ log in */

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isDatabaseConfigured()) return SETUP_REQUIRED;

  const parsed = signInSchema.safeParse({
    email: readString(formData, "email"),
    password: readString(formData, "password"),
  });

  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  const ip = await clientIp();
  // Limited by address as well as by IP, so a botnet cannot spread guesses
  // against one account across many clients.
  for (const key of [ip, `${ip}:${parsed.data.email}`, parsed.data.email]) {
    const limit = consume("signIn", key);
    if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: DEFAULT_AUTHENTICATED_ROUTE,
    });
    return { ok: true };
  } catch (error) {
    // A successful sign-in redirects by throwing; let that through.
    if (isRedirectError(error)) throw error;

    const code = (error as { cause?: { err?: { code?: string } }; code?: string })
      ?.cause?.err?.code;

    if (code === "unverified") {
      return {
        ok: false,
        unverifiedEmail: parsed.data.email,
        message:
          "Your email address has not been verified. Please verify it before logging in.",
      };
    }

    // Everything else is deliberately indistinguishable.
    return { ok: false, message: "Invalid email or password." };
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/* ------------------------------------------------------------ verification */

export async function verifyEmailAction(token: string): Promise<ActionState> {
  if (!isDatabaseConfigured()) return SETUP_REQUIRED;

  const limit = consume("verifyEmail", await clientIp());
  if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };

  const result = await verifyEmailToken(token);
  if (!result.ok) {
    return {
      ok: false,
      message: "This verification link is invalid or has expired.",
    };
  }

  return { ok: true };
}

export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isDatabaseConfigured()) return SETUP_REQUIRED;

  const parsed = emailOnlySchema.safeParse({ email: readString(formData, "email") });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const ip = await clientIp();
  for (const key of [ip, parsed.data.email]) {
    const limit = consume("resendVerification", key);
    if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };
  }

  await resendVerification(parsed.data.email);

  // Always the same answer, so this cannot be used to test whether an address
  // is registered or already verified.
  return {
    ok: true,
    message:
      "If that address needs verifying, we've sent a new link. Please check your inbox.",
  };
}

/* ---------------------------------------------------------- password reset */

export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isDatabaseConfigured()) return SETUP_REQUIRED;

  const parsed = emailOnlySchema.safeParse({ email: readString(formData, "email") });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const ip = await clientIp();
  for (const key of [ip, parsed.data.email]) {
    const limit = consume("forgotPassword", key);
    if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };
  }

  // The outcome is deliberately discarded. One response covers "sent",
  // "unverified" and "no account": the unverified case still receives a
  // verification email instead of a reset link, but saying so here would reveal
  // both that the address exists and what state it is in.
  await requestPasswordReset(parsed.data.email);

  return {
    ok: true,
    message:
      "If an eligible account exists for that email, a password reset link has been sent. " +
      "Accounts that haven't been verified yet will receive a verification link instead.",
  };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isDatabaseConfigured()) return SETUP_REQUIRED;

  const parsed = resetPasswordSchema.safeParse({
    token: readString(formData, "token"),
    password: readString(formData, "password"),
    confirmPassword: readString(formData, "confirmPassword"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const limit = consume("resetPassword", await clientIp());
  if (!limit.ok) return { ok: false, message: rateLimitMessage(limit) };

  const result = await resetPassword(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return {
      ok: false,
      message:
        "This reset link is invalid or has expired. Request a new one to continue.",
    };
  }

  return { ok: true };
}
