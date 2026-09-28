-- ============================================================
-- Workbook as the brain
--
-- The admin workbook is the authority for WHAT initiatives exist, WHAT tasks
-- each one needs, HOW far ahead each task must happen, and WHAT conversion
-- benchmarks apply. Until now it was stored as one opaque JSONB blob and only
-- the first 3 sheets x 8 rows were ever shown to the model, so Claude invented
-- task lists and lead times instead of using the authored ones.
--
-- These tables make the workbook queryable so generation can look things up
-- per channel instead of guessing. They are DERIVED DATA: every upload
-- replaces them wholesale, and `workbook_data` remains the raw source.
--
-- Service-role writes only (ingest runs server-side). All authenticated users
-- may read, because generation and the initiative library UI need it.
-- ============================================================

-- Stable join key across all four tables, derived from the workbook's own
-- initiative naming (trimmed, lowercased, punctuation collapsed).
CREATE TABLE IF NOT EXISTS wb_initiative_library (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_key   TEXT NOT NULL UNIQUE,
  workbook_id      TEXT,                       -- the sheet's own ID column, e.g. 'IN11'
  name             TEXT NOT NULL,
  category         TEXT,
  -- Workbook rates difficulty 1-5 (1 easy, 5 very hard). The app scale is being
  -- aligned to 1-5 to match, rather than rescaling on the way in.
  difficulty       INT CHECK (difficulty BETWEEN 1 AND 5),
  speed_to_results TEXT,                       -- 'Fast' | 'Slow' | etc, free text
  one_liner        TEXT,
  description      TEXT,
  needs_sales_team TEXT,
  price_tier       TEXT,
  own_or_ops       TEXT,                       -- answers "are we specifying OPS"
  display_order    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wb_benchmarks (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_key TEXT NOT NULL,
  metric         TEXT NOT NULL,
  -- Conservative / Moderate / Aggressive map onto the app's Good / Better / Best.
  -- Stored as fractions (0.15), normalised on ingest because the sheet mixes
  -- '15%' strings with 0.3 decimals.
  conservative   NUMERIC,
  moderate       NUMERIC,
  aggressive     NUMERIC,
  unit           TEXT,
  source         TEXT,
  -- Many rows read 'PLACEHOLDER - verify w/ Pete's data'. Flagged so the UI can
  -- mark a number unverified instead of presenting a guess as authored data.
  is_placeholder BOOLEAN NOT NULL DEFAULT FALSE,
  rule_of_thumb  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wb_task_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_key  TEXT NOT NULL,
  task_number     INT,
  name            TEXT NOT NULL,
  category        TEXT,
  -- The authored 'Lead time (days before launch)'. This is the authoritative
  -- daysBeforeEvent: non-negative, counted back from the event.
  lead_days       INT NOT NULL DEFAULT 0,
  duration_hours  NUMERIC,
  role            TEXT,
  depends_on      INT[] NOT NULL DEFAULT '{}', -- task_numbers within the same template
  notes           TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wb_ai_context (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_key   TEXT NOT NULL UNIQUE,
  when_to_use      TEXT,
  best_fit         TEXT,
  min_budget       TEXT,
  min_assets       TEXT,
  why_it_works     TEXT,
  what_to_avoid    TEXT,
  sequencing_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wb_bench_key    ON wb_benchmarks(initiative_key);
CREATE INDEX IF NOT EXISTS idx_wb_tasks_key    ON wb_task_templates(initiative_key);
CREATE INDEX IF NOT EXISTS idx_wb_tasks_order  ON wb_task_templates(initiative_key, display_order);

-- RLS: read for any signed-in user, writes via service role only.
ALTER TABLE wb_initiative_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_benchmarks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_task_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_ai_context         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['wb_initiative_library','wb_benchmarks','wb_task_templates','wb_ai_context']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'Authenticated can read workbook'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Authenticated can read workbook" ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t
      );
    END IF;
  END LOOP;
END $$;
