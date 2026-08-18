/**
 * Route protection.
 *
 * Runs before every matched request, so an unauthenticated visitor never
 * reaches a protected page — not even briefly while the client hydrates.
 * The check uses the Edge-safe half of the config; the real credential check
 * lives in the Node runtime.
 */

import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals, the auth API (which must stay
     * reachable to sign in) and static assets.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
