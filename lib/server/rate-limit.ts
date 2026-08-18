/**
 * Rate limiting for security-sensitive endpoints.
 *
 * A fixed-window counter held in module memory. That is deliberately modest:
 * it stops password guessing and mail-flooding from a single client, and it
 * needs no infrastructure. On a multi-instance deployment each instance keeps
 * its own counters, so the effective limit is per instance — swap
 * `consume` for a Redis/Upstash counter when that matters. The call sites do
 * not change.
 */

export interface RateLimitRule {
  /** Attempts allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

/** Tuned per action: login is guessable, mail sending is abusable. */
export const RATE_LIMITS = {
  signUp: { limit: 5, windowMs: 60 * 60 * 1000 },
  signIn: { limit: 10, windowMs: 15 * 60 * 1000 },
  resendVerification: { limit: 3, windowMs: 60 * 60 * 1000 },
  forgotPassword: { limit: 5, windowMs: 60 * 60 * 1000 },
  resetPassword: { limit: 10, windowMs: 60 * 60 * 1000 },
  verifyEmail: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Drops expired buckets so the map cannot grow without bound. */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Records one attempt.
 *
 * `key` should combine the action with whatever identifies the client — the IP
 * for anonymous endpoints, and additionally the email where an attacker could
 * otherwise rotate addresses behind one IP.
 */
export function consume(
  action: RateLimitAction,
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  const rule = RATE_LIMITS[action];
  const bucketKey = `${action}:${key}`;
  sweep(now);

  const existing = buckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000),
  );

  if (existing.count > rule.limit) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  return {
    ok: true,
    remaining: rule.limit - existing.count,
    retryAfterSeconds,
  };
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** A human message that does not disclose which limit was hit. */
export function rateLimitMessage(result: RateLimitResult): string {
  const minutes = Math.ceil(result.retryAfterSeconds / 60);
  return minutes <= 1
    ? "Too many attempts. Please wait a minute and try again."
    : `Too many attempts. Please try again in about ${minutes} minutes.`;
}
