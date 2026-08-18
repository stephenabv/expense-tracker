/**
 * Validation schemas.
 *
 * These are the authoritative rules. Every server action parses its raw input
 * through them before touching the database; the client imports the same
 * schemas purely so the user gets the identical message immediately, never as a
 * substitute for the server check.
 */

import { z } from "zod";

/* -------------------------------------------------------------------- name */

export const NAME_MIN = 2;
export const NAME_MAX = 80;

/**
 * Collapses whitespace runs and trims.
 *
 * Names are stored normalised so "  Maria   Santos " and "Maria Santos" are the
 * same stored value rather than two different-looking records.
 */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Control characters and angle brackets.
 *
 * React escapes on render, so this is defence in depth rather than the only
 * guard — but no legitimate name contains a NUL byte or a tag delimiter, so
 * refusing them costs nothing.
 */
const FORBIDDEN_IN_NAME = /[<>\u0000-\u001F\u007F]/;

export const nameSchema = z
  .string({ error: "Enter your name." })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(NAME_MIN, `Your name must be at least ${NAME_MIN} characters.`)
      .max(NAME_MAX, `Your name must be ${NAME_MAX} characters or fewer.`)
      .refine((value) => !FORBIDDEN_IN_NAME.test(value), {
        message: "Your name contains characters that aren't allowed.",
      })
      // A name made only of punctuation is malformed, but the check stays
      // script-agnostic so names in any alphabet pass.
      .refine((value) => /\p{L}/u.test(value), {
        message: "Your name must contain at least one letter.",
      }),
  );

/* ------------------------------------------------------------------ gender */

/**
 * The allowed set. Submitted values are checked against this on the server, so
 * a hand-crafted request cannot store an arbitrary string.
 *
 * Adding an option later means adding it here and to `GENDER_LABELS` — the
 * select, the schema and the database CHECK all read from this one list.
 */
export const GENDERS = [
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
] as const;

export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

export const genderSchema = z.enum(GENDERS, { error: "Select a gender." });

/* ------------------------------------------------------------------- email */

/** RFC 5321 maximum length of a forward path. */
export const EMAIL_MAX = 254;

/** Lowercased and trimmed, so lookups are consistently case-insensitive. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .transform(normalizeEmail)
  .pipe(
    z
      .email("Enter a valid email address.")
      .max(EMAIL_MAX, "That email address is too long."),
  );

/* ---------------------------------------------------------------- password */

export const PASSWORD_MIN = 8;
/** Bounded so a huge input cannot burn CPU inside the hash. */
export const PASSWORD_MAX = 128;

export interface PasswordChecks {
  length: boolean;
  lowercase: boolean;
  uppercase: boolean;
  number: boolean;
  special: boolean;
}

/** Individual rule results, for the live checklist on the form. */
export function checkPassword(password: string): PasswordChecks {
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    // Anything that is not a letter, digit or whitespace counts as special.
    special: /[^A-Za-z0-9\s]/.test(password),
  };
}

export function passwordSatisfiesAll(password: string): boolean {
  return Object.values(checkPassword(password)).every(Boolean);
}

export const PASSWORD_RULE_LABELS: Array<{
  key: keyof PasswordChecks;
  label: string;
}> = [
  { key: "length", label: `At least ${PASSWORD_MIN} characters` },
  { key: "uppercase", label: "One uppercase letter" },
  { key: "lowercase", label: "One lowercase letter" },
  { key: "number", label: "One number" },
  { key: "special", label: "One special character" },
];

/**
 * The password itself is never trimmed or otherwise rewritten — altering it
 * would change the secret the user chose.
 */
export const passwordSchema = z
  .string({ error: "Enter a password." })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`)
  .refine((value) => checkPassword(value).lowercase, {
    message: "Include a lowercase letter.",
  })
  .refine((value) => checkPassword(value).uppercase, {
    message: "Include an uppercase letter.",
  })
  .refine((value) => checkPassword(value).number, {
    message: "Include a number.",
  })
  .refine((value) => checkPassword(value).special, {
    message: "Include a special character.",
  });

/* ------------------------------------------------------------------- forms */

export const signUpSchema = z
  .object({
    name: nameSchema,
    gender: genderSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately unvalidated beyond presence: applying the strength rules at
  // login would reveal which rules an existing account's password satisfies.
  password: z.string().min(1, "Enter your password."),
});

export const emailOnlySchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "This reset link is invalid."),
    password: passwordSchema,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Flattens a Zod error into `{ field: message }` for the forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in result)) {
      result[key] = issue.message;
    }
  }
  return result;
}
