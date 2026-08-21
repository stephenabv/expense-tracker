-- Fully spent budgets.
--
-- A budget whose remaining balance reaches exactly zero becomes a closed
-- historical record: it can no longer be edited, deleted, or spent against, and
-- neither can any of its expenses.
--
-- That state is stored, not derived. `amount - SUM(expenses) = 0` is a fact
-- about the numbers right now; whether the budget was *closed* is a fact about
-- its lifecycle, and the two can disagree — an allotment edited up to a larger
-- amount would silently reopen if the lock were only ever recomputed. Storing
-- `status` and `completed_at` also means the rule can be enforced in SQL, by
-- constraining the write rather than trusting the caller to have checked first.

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_status_values'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_status_values
      CHECK (status IN ('active', 'fully_spent'));
  END IF;

  -- The timestamp and the status are one fact recorded twice; a row carrying
  -- only half of it would make "when was this closed?" unanswerable.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_completion_paired'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_completion_paired
      CHECK ((status = 'fully_spent') = (completed_at IS NOT NULL));
  END IF;
END
$do$;

-- Existing budgets that already sit at exactly zero were fully spent before
-- this migration existed; closing them now keeps history consistent with the
-- rule rather than leaving a population that the rule never applied to.
-- A budget with no expenses at all is left alone: nothing was ever spent, so it
-- was never "spent out" — including a ₱0 allotment that has yet to be used.
UPDATE budgets b
   SET status = 'fully_spent',
       completed_at = now()
 WHERE b.status = 'active'
   AND EXISTS (SELECT 1 FROM expenses e WHERE e.budget_id = b.id)
   AND b.amount_centavos = (
         SELECT COALESCE(SUM(e.amount_centavos), 0)
           FROM expenses e
          WHERE e.budget_id = b.id
       );

-- The dashboard and every selector ask for one user's open allotments, so that
-- is the shape the index should serve.
CREATE INDEX IF NOT EXISTS budgets_user_status_idx ON budgets (user_id, status);
