/**
 * User records.
 *
 * The password hash lives behind `findUserCredentials`, which is the only
 * function that selects it. Every other read returns the public shape, so a
 * hash cannot reach a component, an API response or a log by accident.
 */

import { randomUUID } from "node:crypto";

import { getDatabase, type SqlExecutor } from "@/lib/db/client";
import type { Gender } from "@/lib/auth/schemas";

/** Safe to send to the client. */
export interface PublicUser {
  id: string;
  name: string;
  gender: Gender;
  email: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

/** Server-only: carries the hash. */
export interface UserCredentials extends PublicUser {
  passwordHash: string;
}

interface UserRow {
  id: string;
  name: string;
  gender: Gender;
  email: string;
  password_hash: string;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    email: row.email,
    emailVerifiedAt: toDate(row.email_verified_at),
    createdAt: toDate(row.created_at)!,
  };
}

export interface CreateUserInput {
  name: string;
  gender: Gender;
  /** Must already be normalised. */
  email: string;
  passwordHash: string;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("That email address is already registered.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export async function createUser(
  input: CreateUserInput,
  db: SqlExecutor = getDatabase(),
): Promise<PublicUser> {
  const id = randomUUID();

  try {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (id, name, gender, email, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, gender, email, password_hash, email_verified_at, created_at`,
      [id, input.name, input.gender, input.email, input.passwordHash],
    );
    return toPublicUser(rows[0]);
  } catch (error) {
    // 23505 = unique_violation. The unique index is what actually prevents a
    // duplicate; two simultaneous sign-ups cannot both pass a prior SELECT.
    if ((error as { code?: string }).code === "23505") {
      throw new EmailAlreadyRegisteredError();
    }
    throw error;
  }
}

export async function findUserByEmail(
  email: string,
  db: SqlExecutor = getDatabase(),
): Promise<PublicUser | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, name, gender, email, password_hash, email_verified_at, created_at
       FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/** Server-only. The single place a password hash is read. */
export async function findUserCredentials(
  email: string,
  db: SqlExecutor = getDatabase(),
): Promise<UserCredentials | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, name, gender, email, password_hash, email_verified_at, created_at
       FROM users WHERE email = $1`,
    [email],
  );
  if (!rows[0]) return null;
  return { ...toPublicUser(rows[0]), passwordHash: rows[0].password_hash };
}

export async function findUserById(
  id: string,
  db: SqlExecutor = getDatabase(),
): Promise<PublicUser | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, name, gender, email, password_hash, email_verified_at, created_at
       FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function markEmailVerified(
  userId: string,
  db: SqlExecutor = getDatabase(),
): Promise<void> {
  await db.query(
    `UPDATE users SET email_verified_at = now(), updated_at = now()
      WHERE id = $1 AND email_verified_at IS NULL`,
    [userId],
  );
}

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
  db: SqlExecutor = getDatabase(),
): Promise<void> {
  await db.query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [userId, passwordHash],
  );
}

export function isVerified(user: Pick<PublicUser, "emailVerifiedAt">): boolean {
  return user.emailVerifiedAt !== null;
}
