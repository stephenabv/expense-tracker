/**
 * Auth.js instance (Node runtime only).
 *
 * The Credentials provider is the one place a password is checked. It delegates
 * to `authenticate`, so the verification gate and the timing-equalised lookup
 * apply to every sign-in — there is no second path into a session.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/lib/auth/auth.config";
import { authenticate } from "@/lib/auth/service";
import { signInSchema } from "@/lib/auth/schemas";

/**
 * Thrown when the password was right but the address is unverified.
 *
 * Auth.js flattens provider errors, so the reason travels as the error `code`
 * and the login page turns it into the "resend verification" prompt.
 */
export class UnverifiedEmailError extends Error {
  code = "unverified";
  constructor() {
    super("unverified");
    this.name = "UnverifiedEmailError";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(raw) {
        // Re-validated here even though the form already did: this callback is
        // reachable by any POST to the Auth.js endpoint.
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) return null;

        const result = await authenticate(parsed.data.email, parsed.data.password);

        if (!result.ok) {
          if (result.reason === "unverified") throw new UnverifiedEmailError();
          // `null` becomes a generic "invalid email or password".
          return null;
        }

        // Only non-sensitive fields reach the token; the hash never leaves the
        // credentials lookup.
        return {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          gender: result.user.gender,
        };
      },
    }),
  ],
});
