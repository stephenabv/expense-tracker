/**
 * Application identity.
 *
 * The single source for the name and version. Nothing else should hardcode
 * either — the footer, the PDF metadata and any future about-screen read from
 * here, so releasing means changing one line.
 */

/**
 * The product's name, as it appears in the header, emails and PDF metadata.
 * Centralized here so a rename is one edit rather than a search.
 */
export const APP_NAME = "Expense Tracker";

/** Semantic version. Keep `package.json` in step with it. */
export const APP_VERSION = "1.0.0";

/**
 * Short build identifier, or null when it cannot be determined.
 *
 * Supplied at build time from the commit the deployment was built from —
 * Vercel's own `VERCEL_GIT_COMMIT_SHA`, or `git rev-parse` locally (see
 * `next.config.ts`). Only the first seven characters are exposed: enough to
 * identify a build, and nothing about the repository, the environment or the
 * branch. It is public information about an already-public repo, not a secret.
 */
export const BUILD_ID: string | null =
  process.env.NEXT_PUBLIC_BUILD_ID?.trim().slice(0, 7) || null;

/**
 * The footer line, e.g. `Finance Tracker | 2026 | v1.0.0 | Build a83f91c`.
 *
 * The year is read at render time rather than baked in, so a deployment that
 * outlives New Year does not display a stale copyright.
 */
export function footerParts(now: Date = new Date()): string[] {
  const parts = [APP_NAME, String(now.getFullYear()), `v${APP_VERSION}`];
  if (BUILD_ID) parts.push(`Build ${BUILD_ID}`);
  return parts;
}
