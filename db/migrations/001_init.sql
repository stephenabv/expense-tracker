-- Expense Tracker schema.
--
-- Money is stored as integer centavos, never a float: the app's arithmetic is
-- already centavo-based and this keeps the database from reintroducing drift.
--
-- Calendar dates are stored as YYYY-MM-DD text rather than DATE. Budget periods
-- and expense dates are calendar concepts in the user's own timezone; a DATE
-- column round-tripped through a driver invites an off-by-one-day bug, and
-- zero-padded text sorts chronologically anyway.

CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  gender          text NOT NULL CHECK (gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say')),
  -- Always stored lowercase and trimmed, so the unique index is the
  -- case-insensitive uniqueness guarantee.
  email           text NOT NULL,
  password_hash   text NOT NULL,
  email_verified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- Verification and reset tokens are stored only as SHA-256 hashes. A database
-- disclosure therefore cannot be replayed to verify an address or seize an
-- account: the raw token exists only in the email that was sent.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_hash_key
  ON email_verification_tokens (token_hash);
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_key
  ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS budgets (
  id              text PRIMARY KEY,
  -- Ownership lives on the row. Every query filters on it, so a stray id in a
  -- request can never reach another account's data.
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  amount_centavos bigint NOT NULL CHECK (amount_centavos >= 0),
  start_date      text NOT NULL CHECK (start_date ~ '^\d{4}-\d{2}-\d{2}$'),
  end_date        text NOT NULL CHECK (end_date ~ '^\d{4}-\d{2}-\d{2}$'),
  locked          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budgets_period_ordered CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS budgets_user_idx ON budgets (user_id, start_date DESC);

CREATE TABLE IF NOT EXISTS expenses (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  budget_id       text NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  amount_centavos bigint NOT NULL CHECK (amount_centavos > 0),
  expense_date    text NOT NULL CHECK (expense_date ~ '^\d{4}-\d{2}-\d{2}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_user_idx ON expenses (user_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS expenses_budget_idx ON expenses (budget_id);
