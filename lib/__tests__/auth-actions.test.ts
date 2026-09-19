/**
 * What the auth actions tell a user when the database is down.
 *
 * Each action's own failure message is deliberately vague so it cannot be used
 * to probe for addresses. An outage is the one failure that must escape that
 * vagueness: it is the same answer for every address, so it reveals nothing,
 * and reported as "invalid email or password" it sends people to reset a
 * credential that was never wrong.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseUnavailableError } from "@/lib/db/client";

const signIn = vi.fn();

vi.mock("@/auth", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: vi.fn(),
}));

const registerUser = vi.fn();
const requestPasswordReset = vi.fn();

vi.mock("@/lib/auth/service", () => ({
  registerUser: (...args: unknown[]) => registerUser(...args),
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
  resendVerification: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmailToken: vi.fn(),
}));

/** Each test gets its own address, so the rate limiter never crosses them. */
let caller = "203.0.113.1";

vi.mock("@/lib/server/request", () => ({ clientIp: async () => caller }));

const { forgotPasswordAction, signInAction, signUpAction } = await import(
  "@/lib/server/auth-actions"
);

const UNAVAILABLE = /can't reach the service/i;

/** The pooler's answer to an unknown project ref, as Auth.js hands it back. */
function callbackRouteError(): Error {
  return Object.assign(new Error("CallbackRouteError"), {
    cause: {
      err: new DatabaseUnavailableError(
        new Error("(ENOTFOUND) tenant/user postgres.abc not found"),
      ),
      provider: "credentials",
    },
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const CREDENTIALS = { email: "juan@example.com", password: "Sup3rSecret!" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/postgres";
  caller = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
});

describe("signInAction", () => {
  it("says the service is unreachable when the database is down", async () => {
    signIn.mockRejectedValue(callbackRouteError());

    const state = await signInAction({}, form(CREDENTIALS));

    expect(state.ok).toBe(false);
    expect(state.message).toMatch(UNAVAILABLE);
  });

  it("still refuses a wrong password without naming the reason", async () => {
    signIn.mockRejectedValue(new Error("CredentialsSignin"));

    const state = await signInAction({}, form(CREDENTIALS));

    expect(state.message).toBe("Invalid email or password.");
  });

  it("still asks an unverified account to verify", async () => {
    signIn.mockRejectedValue(
      Object.assign(new Error("CallbackRouteError"), {
        cause: { err: { code: "unverified" } },
      }),
    );

    const state = await signInAction({}, form(CREDENTIALS));

    expect(state.unverifiedEmail).toBe(CREDENTIALS.email);
    expect(state.message).toMatch(/has not been verified/i);
  });
});

describe("the other actions", () => {
  it("reports an unreachable database on sign-up", async () => {
    registerUser.mockRejectedValue(new DatabaseUnavailableError(null));

    const state = await signUpAction(
      {},
      form({
        name: "Juan Dela Cruz",
        gender: "male",
        email: CREDENTIALS.email,
        password: CREDENTIALS.password,
        confirmPassword: CREDENTIALS.password,
      }),
    );

    expect(state.ok).toBe(false);
    expect(state.message).toMatch(UNAVAILABLE);
  });

  it("reports an unreachable database on forgot-password", async () => {
    requestPasswordReset.mockRejectedValue(new DatabaseUnavailableError(null));

    const state = await forgotPasswordAction({}, form({ email: CREDENTIALS.email }));

    expect(state.ok).toBe(false);
    expect(state.message).toMatch(UNAVAILABLE);
  });

  it("lets an unrelated fault surface rather than dressing it as an outage", async () => {
    requestPasswordReset.mockRejectedValue(new Error("SMTP relay refused"));

    await expect(
      forgotPasswordAction({}, form({ email: CREDENTIALS.email })),
    ).rejects.toThrow("SMTP relay refused");
  });
});
