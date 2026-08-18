/**
 * Route policy, in one place.
 *
 * Shared by the middleware and the pages so there is a single answer to "is
 * this page public?" — a route added to one list and forgotten in another is
 * exactly how an unprotected page happens.
 */

/** Reachable without a session. */
export const PUBLIC_ROUTES = [
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
] as const;

/** Requires an authenticated (and therefore verified) session. */
export const PROTECTED_ROUTES = [
  "/tracker",
  "/budgets",
  "/history",
  "/profile",
] as const;

export const DEFAULT_AUTHENTICATED_ROUTE = "/tracker";
export const LOGIN_ROUTE = "/login";

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
