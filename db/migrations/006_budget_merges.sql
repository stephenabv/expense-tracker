-- Combining two allotments into one.
--
-- A merge is a structural operation, not a financial one: it changes which
-- budget the money sits in and nothing about the money itself. So the expenses
-- move to the new allotment with every field they had — id, amount, date, name,
-- kind, timestamps — and the two originals stay as records of what they held at
-- the moment they were merged.
--
-- Those snapshots are why `budget_merges` stores figures rather than just ids.
-- Once the expenses have moved, a source budget's live balance no longer says
-- anything about the budget it was; the only place its pre-merge state survives
-- is here.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;

-- RESTRICT for the same reason the transfer links are: the merged budget is the
-- answer to "where did this allotment go?", and deleting it would erase that.
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS merged_into_budget_id text
    REFERENCES budgets (id) ON DELETE RESTRICT;

/*
 * How much of this allotment is money from outside.
 *
 * The allotted total across budgets may not count the same pesos twice, which
 * is why a transferred allotment has never contributed to it — its money was
 * already counted where it came from. A merge makes that a matter of degree
 * rather than a yes/no: merging a ₱2,000 transferred fund with a ₱1,000 direct
 * one produces a ₱3,000 allotment of which only ₱1,000 is new money. A boolean
 * cannot express that; either answer it could give would invent ₱2,000 or
 * destroy ₱1,000. The figure carries through any depth of merging.
 */
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS funded_amount_centavos bigint;

-- Existing rows predate the column: a directly created allotment is entirely
-- its own money, a transferred one is none of it.
UPDATE budgets
   SET funded_amount_centavos =
         CASE WHEN allocation_type = 'transferred' THEN 0 ELSE amount_centavos END
 WHERE funded_amount_centavos IS NULL;

ALTER TABLE budgets
  ALTER COLUMN funded_amount_centavos SET NOT NULL;

DO $do$
BEGIN
  -- 'merged' joins the lifecycle. Like 'fully_spent' it is permanent, and it
  -- locks the budget just as firmly — but for a different reason: the allotment
  -- was not spent out, it was folded into another one.
  ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_status_values;
  ALTER TABLE budgets ADD CONSTRAINT budgets_status_values
    CHECK (status IN ('active', 'fully_spent', 'merged'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_merge_paired'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_merge_paired
      CHECK (
        (status = 'merged')
          = (merged_into_budget_id IS NOT NULL AND merged_at IS NOT NULL)
      );
  END IF;

  -- An allotment merged into itself would be a loop with no destination.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_merge_not_self'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_merge_not_self
      CHECK (merged_into_budget_id IS NULL OR merged_into_budget_id <> id);
  END IF;

  -- Outside money cannot exceed the allotment holding it, and cannot be
  -- negative. A merged allotment usually holds less than its amount, because
  -- part of it arrived by transfer.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_funded_within_amount'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_funded_within_amount
      CHECK (funded_amount_centavos BETWEEN 0 AND amount_centavos);
  END IF;
END
$do$;

/*
 * What each source allotment held when it was merged.
 *
 * One row per source, so a merge of two budgets is two rows sharing a
 * `merged_budget_id`. A dedicated table rather than columns on the budget
 * because lineage is expected to chain: a merged allotment can itself be
 * merged, and each step keeps its own record of what went in.
 */
CREATE TABLE IF NOT EXISTS budget_merges (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The allotment produced by the merge.
  merged_budget_id  text NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
  -- One of the allotments folded into it.
  source_budget_id  text NOT NULL REFERENCES budgets (id) ON DELETE RESTRICT,
  -- The source's name at the time, so a later rename cannot rewrite the record.
  source_name       text NOT NULL,
  amount_centavos   bigint NOT NULL,
  -- Spending and transfers are kept apart here exactly as they are everywhere
  -- else: a transfer out of a source was never spending.
  expense_centavos  bigint NOT NULL DEFAULT 0,
  transfer_centavos bigint NOT NULL DEFAULT 0,
  merged_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_merges_not_self CHECK (merged_budget_id <> source_budget_id)
);

-- A budget can be folded into another only once.
CREATE UNIQUE INDEX IF NOT EXISTS budget_merges_source_key
  ON budget_merges (source_budget_id);

CREATE INDEX IF NOT EXISTS budget_merges_target_idx
  ON budget_merges (merged_budget_id);

CREATE INDEX IF NOT EXISTS budget_merges_user_idx
  ON budget_merges (user_id, merged_at DESC);

-- Same reasoning as migration 002: a table left readable by the hosted data API
-- would expose one account's records to anyone holding the publishable key.
ALTER TABLE budget_merges ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE budget_merges FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE budget_merges FROM authenticated;
  END IF;
END
$do$;
