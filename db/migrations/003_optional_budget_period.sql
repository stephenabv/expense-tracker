-- Budget allotments without a date restriction.
--
-- A budget may now be general: available whatever the expense date. That is
-- stored as two NULLs, never as sentinel dates like 1900-01-01, which would
-- sort, filter and print as if they were real days.
--
-- The existing per-column regex CHECKs already tolerate NULL — an unknown
-- compared to anything yields unknown, and CHECK only rejects on false — so
-- only the NOT NULL declarations have to go. The same is true of
-- `budgets_period_ordered`, which passes for a general budget.

ALTER TABLE budgets ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE budgets ALTER COLUMN end_date DROP NOT NULL;

-- A half-set period is not a period. Either both ends are given, or neither is:
-- every read path treats one NULL as "general", so a row with a lone start date
-- would silently lose that date's restriction.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_period_paired'
  ) THEN
    ALTER TABLE budgets ADD CONSTRAINT budgets_period_paired
      CHECK ((start_date IS NULL) = (end_date IS NULL));
  END IF;
END
$do$;

-- Listing order puts dated allotments first, so NULLs sort last on a DESC scan.
DROP INDEX IF EXISTS budgets_user_idx;
CREATE INDEX IF NOT EXISTS budgets_user_idx
  ON budgets (user_id, start_date DESC NULLS LAST);
