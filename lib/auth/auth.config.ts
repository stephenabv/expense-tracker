/**
 * Edge-safe Auth.js configuration.
 *
 * The middleware runs on the Edge runtime, where the Argon2 native binding and
 * the Postgres driver cannot load. This half of the config carries no such
 * imports; the Credentials provider that needs them is added in `auth.ts`,
 * which only ever runs on Node.
 */

import type { NextAuthConfig } from "next-auth";

import {
  DEFAULT_AUTHENTICATED_ROUTE,
  LOGIN_ROUTE,
  isProtectedRoute,
} from "@/lib/auth/routes";

/** Sessions last a week and slide forward as the user keeps working. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const authConfig = {
  pages: {
    signIn: LOGIN_ROUTE,
    error: LOGIN_ROUTE,
  },

  session: {
    // Stateless, so the session lives in an encrypted HTTP-only cookie rather
    // than anywhere the browser's scripts can read.
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  callbacks: {
    /** Consulted by the middleware for every matched request. */
    authorized({ auth, request }) {
      const signedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      if (isProtectedRoute(pathname)) return signedIn;

      // Someone already signed in has no use for the login or sign-up pages.
      if (signedIn && (pathname === LOGIN_ROUTE || pathname === "/signup")) {
        return Response.redirect(new URL(DEFAULT_AUTHENTICATED_ROUTE, request.nextUrl));
      }

      return true;
    },

    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.name = user.name ?? null;
        token.email = user.email ?? null;
        token.gender = (user as { gender?: string }).gender;
      }
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.gender = token.gender as string | undefined;
      }
      return session;
    },
  },

  // Providers are attached in `auth.ts`; the middleware needs none.
  providers: [],
} satisfies NextAuthConfig;
