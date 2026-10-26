-- ============================================================
-- 051: SEVEN RECURRENCE FREQUENCIES + RAW WORKBOOK CELLS
--
-- (a) The frequency vocabulary grows from weekly | monthly | quarterly to
--     weekly | bi-weekly | monthly | bi-monthly | quarterly | semi-annually | annually
--     (src/lib/intake-forecast.ts REPEAT_FREQUENCIES). Three CHECKs carry the
--     old list and are widened, keeping their original names:
--       initiatives_repeat_frequency_check                     (036)
--       intake_initiatives_repeat_frequency_check              (025, inline;
--                                                               the default name)
--       initiative_library_config_allowed_frequencies_check    (045)
--     WHY DROP BY DEFINITION FIRST: 025 declared its CHECK inline, so its name
--     is whatever Postgres chose. The DO block drops every CHECK on those
--     columns whatever it is called, then each is re-added by name. Without
--     it a differently-named old CHECK would survive and keep refusing the
--     new values.
--
--     Code does not depend on this being applied: a write refused by the old
--     CHECK (23514) is retried once without the new value
--     (src/lib/initiatives/frequency-fallback.ts).
--
-- (b) wb_initiative_library gains two nullable TEXT columns holding the raw
--     "Frequency" and "Allowed Frequencies" workbook cells, unparsed.
--
-- Writes no data. Safe to re-run.
-- ============================================================

-- 1. Drop every existing CHECK on the three frequency columns, by definition.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND (
             (c.conrelid = to_regclass('public.initiatives')
                AND pg_get_constraintdef(c.oid) ILIKE '%repeat_frequency%')
          OR (c.conrelid = to_regclass('public.intake_initiatives')
                AND pg_get_constraintdef(c.oid) ILIKE '%repeat_frequency%')
          OR (c.conrelid = to_regclass('public.initiative_library_config')
                AND pg_get_constraintdef(c.oid) ILIKE '%allowed_frequencies%')
           )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END
$$;

-- 2. initiatives.repeat_frequency (036).
ALTER TABLE initiatives
  DROP CONSTRAINT IF EXISTS initiatives_repeat_frequency_check;

ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_repeat_frequency_check
  CHECK (repeat_frequency IS NULL
         OR repeat_frequency IN ('weekly', 'bi-weekly', 'monthly', 'bi-monthly', 'quarterly', 'semi-annually', 'annually'));

COMMENT ON COLUMN initiatives.repeat_frequency IS
  'How often a recurring initiative runs: weekly | bi-weekly | monthly | bi-monthly | quarterly | semi-annually | annually. Mirrors intake_initiatives.repeat_frequency. NULL means no repetition recorded (the new form may hold it in attrs.repeat_frequency instead).';

-- 3. intake_initiatives.repeat_frequency (025).
ALTER TABLE intake_initiatives
  DROP CONSTRAINT IF EXISTS intake_initiatives_repeat_frequency_check;

ALTER TABLE intake_initiatives
  ADD CONSTRAINT intake_initiatives_repeat_frequency_check
  CHECK (repeat_frequency IS NULL
         OR repeat_frequency IN ('weekly', 'bi-weekly', 'monthly', 'bi-monthly', 'quarterly', 'semi-annually', 'annually'));

-- 4. initiative_library_config.allowed_frequencies (045).
ALTER TABLE initiative_library_config
  DROP CONSTRAINT IF EXISTS initiative_library_config_allowed_frequencies_check;

ALTER TABLE initiative_library_config
  ADD CONSTRAINT initiative_library_config_allowed_frequencies_check
  CHECK (allowed_frequencies IS NULL
         OR allowed_frequencies <@ ARRAY['weekly', 'bi-weekly', 'monthly', 'bi-monthly', 'quarterly', 'semi-annually', 'annually']::TEXT[]);

COMMENT ON COLUMN initiative_library_config.allowed_frequencies IS
  'Subset of RecurrenceFrequency: weekly | bi-weekly | monthly | bi-monthly | quarterly | semi-annually | annually, the same vocabulary as initiatives.repeat_frequency and intake_initiatives.repeat_frequency.';

-- 5. Raw workbook cells on wb_initiative_library.
ALTER TABLE wb_initiative_library
  ADD COLUMN IF NOT EXISTS allowed_kinds_raw TEXT;

ALTER TABLE wb_initiative_library
  ADD COLUMN IF NOT EXISTS allowed_frequencies_raw TEXT;

COMMENT ON COLUMN wb_initiative_library.allowed_kinds_raw IS
  'The workbook''s raw "Frequency" cell for this initiative, unparsed (e.g. one-time / recurring / ongoing wording). NULL when the column or cell is blank. Read by the workbook-to-config derivation.';

COMMENT ON COLUMN wb_initiative_library.allowed_frequencies_raw IS
  'The workbook''s raw "Allowed Frequencies" cell for this initiative, unparsed. NULL when the column or cell is blank. Read by the workbook-to-config derivation.';
