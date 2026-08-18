/**
 * Password hashing.
 *
 * Argon2id with the OWASP-recommended baseline parameters. Nothing here is
 * hand-rolled cryptography: the algorithm, salting and verification all come
 * from the vetted implementation.
 *
 * A password is never logged, never returned, and never transformed before
 * hashing — trimming or stripping characters would silently change what the
 * user typed and weaken the secret.
 */

import { hash, verify } from "@node-rs/argon2";

/**
 * OWASP baseline for Argon2id: 19 MiB, 2 iterations, 1 lane.
 *
 * The algorithm is given as its numeric variant (2 = Argon2id) because the
 * library exports it as an ambient const enum, which `isolatedModules` cannot
 * inline.
 */
const ARGON2ID = 2;

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never as an error
    // the caller might mistake for success.
    return false;
  }
}

/**
 * A throwaway verification used when no account matched.
 *
 * Without it, a missing address would answer far faster than a wrong password
 * and the response time alone would reveal which addresses are registered.
 */
export async function fakeVerify(): Promise<void> {
  await hashPassword("timing-equalisation-only");
}
