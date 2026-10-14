-- ============================================================
-- INITIATIVE REPEAT FREQUENCY
--
-- "Multiple webinars across the year are ONE initiative."
--
-- `initiatives.kind` has allowed 'recurring' since migration 001, but there
-- was nowhere to record HOW OFTEN. That made the value unactionable: an
-- initiative marked recurring with no frequency cannot be scheduled, cannot be
-- described to the user beyond the word "recurring", and cannot have its
-- occurrences generated later.
--
-- The intake has collected the answer all along —
-- `intake_initiatives.repeat_frequency` from migration 025 — and the forecast
-- already multiplies revenue by it. The build route then discarded it and
-- wrote every initiative as 'one-time'. So a plan claimed the revenue of
-- twelve monthly webinars while scheduling a single one. This column is where
-- that answer now lands.
--
-- SAME VOCABULARY AS THE INTAKE, deliberately: weekly / monthly / quarterly,
-- matching intake_initiatives.repeat_frequency exactly. A second set of names
-- for one concept guarantees a mapping bug.
--
-- NULLABLE, AND NULL IS MEANINGFUL. It means "no repetition recorded", which
-- is correct for a one-time initiative, for every row created before this
-- migration, and for anything added by hand without the question being asked.
-- A default would invent an answer.
--
-- NO OCCURRENCE ROWS ARE CREATED BY THIS. One initiative stays one row. Whether
-- each run should later get its own dates, tasks and results is a separate
-- decision — see recurring_templates in migration 001, which was specified for
-- exactly that and never implemented.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

ALTER TABLE initiatives
  ADD COLUMN IF NOT EXISTS repeat_frequency TEXT;

-- Added separately from the column so re-running cannot fail on an existing
-- constraint, and so the CHECK can be revised without touching the column.
ALTER TABLE initiatives
  DROP CONSTRAINT IF EXISTS initiatives_repeat_frequency_check;

ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_repeat_frequency_check
  CHECK (repeat_frequency IS NULL
         OR repeat_frequency IN ('weekly', 'monthly', 'quarterly'));

COMMENT ON COLUMN initiatives.repeat_frequency IS
  'How often a recurring initiative runs: weekly | monthly | quarterly. Mirrors intake_initiatives.repeat_frequency. NULL means no repetition recorded, which is correct for one-time work. Does not spawn occurrence rows — one initiative is one row.';

-- "Which initiatives repeat, and how often" — the only query shape this serves,
-- and a partial index because the large majority of rows are NULL.
CREATE INDEX IF NOT EXISTS idx_initiatives_repeat_frequency
  ON initiatives(company_id, repeat_frequency)
  WHERE repeat_frequency IS NOT NULL;
