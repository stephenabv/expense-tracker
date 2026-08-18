/**
 * Request helpers for server actions.
 */

import { headers } from "next/headers";

/**
 * Best-effort client address for rate limiting.
 *
 * A forwarded header can be spoofed, so this is not an identity — it is a
 * bucket key. Sensitive actions are additionally limited per email address so
 * rotating the header alone does not lift the limit.
 */
export async function clientIp(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return list.get("x-real-ip") ?? "unknown";
}
