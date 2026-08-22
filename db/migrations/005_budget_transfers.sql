-- Moving money between allotments.
--
-- A transfer is not a purchase. ₱2,000 moved from Main Budget into a new
-- Emergency Fund leaves the user with exactly as much money as before — it has
-- only changed pocket. So the transaction is recorded against the source (its
-- balance really did drop) but marked with a kind, and every figure that means
-- "what did this person spend" filters transfers out. Counting them as spending
-- would invent expenses; counting the destination's allotment as new budget
-- would invent money. The kind is what keeps both from happening.
--
-- The destination remembers where it came from, so "where did this allotment
-- come from?" always has an answer.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_kind_values'
  ) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_kind_values
      CHECK (kind IN ('expense', 'transfer'));
  END IF;
END
$do$;

-- Partial index: transfers are a small minority of rows, and the reporting
-- queries that separate them always ask for one user's.
CREATE INDEX IF NOT EXISTS expenses_transfer_idx
  ON expenses (user_id) WHERE kind = 'transfer';

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS allocation_type text NOT NULL DEFAULT 'direct';

-- RESTRICT, not CASCADE or SET NULL.
--
-- Deleting the source of a live allotment would either take the destination's
-- funding down with it or quietly erase the answer to "where did this money
-- come from?". Both rewrite a committed transaction, so the database refuses.
-- The application checks first and explains; this is the backstop.
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS source_budget_id text
    REFERENCES budgets (id) ON DELETE RESTRICT;

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS source_transaction_id text
    REFERENCES expenses (id) ON DELETE RESTRICT;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_allocation_values'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_allocation_values
      CHECK (allocation_type IN ('direct', 'transferred'));
  END IF;

  -- A transferred allotment without a source is untraceable, and a source on a
  -- directly created one is a contradiction. The three columns move together.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_allocation_paired'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_allocation_paired
      CHECK (
        (allocation_type = 'transferred')
          = (source_budget_id IS NOT NULL AND source_transaction_id IS NOT NULL)
      );
  END IF;

  -- An allotment funded by itself would be a loop with no origin.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_source_not_self'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_source_not_self
      CHECK (source_budget_id IS NULL OR source_budget_id <> id);
  END IF;
END
$do$;

-- "What did this budget fund?" is asked on every source budget's detail view.
CREATE INDEX IF NOT EXISTS budgets_source_idx
  ON budgets (source_budget_id) WHERE source_budget_id IS NOT NULL;
