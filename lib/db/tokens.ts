/**
 * Verification and password-reset token storage.
 *
 * Only hashes are stored. Redemption is a single conditional UPDATE, so the
 * "not expired and not yet used" test and the marking-as-used happen in one
 * atomic statement — two parallel clicks on the same link cannot both succeed.
 */

import { randomUUID } from "node:crypto";

import { getDatabase, type SqlExecutor } from "@/lib/db/client";
import { hashToken } from "@/lib/auth/tokens";

export type TokenKind = "verification" | "reset";

const TABLES: Record<TokenKind, string> = {
  verification: "email_verification_tokens",
  reset: "password_reset_tokens",
};

export async function storeToken(
  kind: TokenKind,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  db: SqlExecutor = getDatabase(),
): Promise<void> {
  await db.query(
    `INSERT INTO ${TABLES[kind]} (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, tokenHash, expiresAt.toISOString()],
  );
}

/**
 * Invalidates every outstanding token of a kind for a user.
 *
 * Issuing a new link should retire the old one, and completing a reset should
 * retire every reset link that was ever sent.
 */
export async function consumeAllTokens(
  kind: TokenKind,
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<void> {
  await db.query(
    `UPDATE ${TABLES[kind]} SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
}

/**
 * Redeems a raw token, returning the owning user id.
 *
 * Returns `null` for a token that is unknown, expired or already used — the
 * caller cannot tell which, and neither can the person holding the link.
 */
export async function redeemToken(
  kind: TokenKind,
  rawToken: string,
  db: SqlExecutor = getDatabase(),
): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(
    `UPDATE ${TABLES[kind]}
        SET consumed_at = now()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [hashToken(rawToken)],
  );
  return rows[0]?.user_id ?? null;
}

/** How many tokens of a kind were issued to a user recently. */
export async function countRecentTokens(
  kind: TokenKind,
  userId: string,
  since: Date,
  db: SqlExecutor = getDatabase(),
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${TABLES[kind]}
      WHERE user_id = $1 AND created_at >= $2`,
    [userId, since.toISOString()],
  );
  return Number(rows[0]?.count ?? 0);
}
