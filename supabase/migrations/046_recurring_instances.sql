-- ============================================================
-- RECURRING INSTANCES
--
-- One recurring initiative stays ONE initiatives row (036). Its runs are
-- computed from the template (repeat_frequency, first event date) by
-- src/lib/initiatives/recurring.ts and shown as placeholders. A run becomes a
-- row here only once the user says something about it: it ran, it was
-- skipped, it has not happened yet, or it made money. A placeholder nobody
-- touched has NO row, so nothing here ever implies zero revenue.
--
-- WHY A NEW TABLE. recurring_templates (001) was specified for spawning whole
-- initiatives per run and was never used (0 rows); it has no per-run outcome
-- or revenue. results (001) is weekly and keyed by week, not by run. Neither
-- can say "the 3 March webinar was skipped".
--
-- PAUSE IS NOT A NEW COLUMN. initiatives.status already allows paused and
-- retired (001), which are exactly the Pause it and Retire it choices of the
-- skip-streak prompt. A second paused flag would be a second source of truth.
-- ============================================================

-- ------------------------------------------------------------
-- 1. initiative_instances
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS initiative_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  instance_date DATE NOT NULL,
  outcome TEXT,
  actual_revenue NUMERIC(12,2),
  materialised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT initiative_instances_initiative_date_key UNIQUE (initiative_id, instance_date)
);

ALTER TABLE initiative_instances
  DROP CONSTRAINT IF EXISTS initiative_instances_outcome_check;
ALTER TABLE initiative_instances
  ADD CONSTRAINT initiative_instances_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('ran', 'skipped', 'not-yet'));

-- The unique key already serves lookups by initiative; this serves the
-- company-wide "which runs need an answer" query.
CREATE INDEX IF NOT EXISTS idx_initiative_instances_company
  ON initiative_instances(company_id, instance_date);

DROP TRIGGER IF EXISTS set_updated_at ON initiative_instances;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON initiative_instances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE initiative_instances IS
  'One run of a recurring initiative that the user has said something about. Runs with no row are placeholders computed from the template in src/lib/initiatives/recurring.ts. No row means unknown, never zero.';
COMMENT ON COLUMN initiative_instances.instance_date IS
  'The calendar day of the run as the template produced it. Unique per initiative.';
COMMENT ON COLUMN initiative_instances.outcome IS
  'ran | skipped | not-yet, as answered by the user. NULL means not answered; never inferred.';
COMMENT ON COLUMN initiative_instances.actual_revenue IS
  'Revenue the user logged against this run. NULL means not logged, which is not the same as 0.';
COMMENT ON COLUMN initiative_instances.materialised_at IS
  'When the placeholder first became a row.';
COMMENT ON COLUMN initiative_instances.updated_at IS
  'Last write. The skip streak compares it to initiatives.correction_kept_at so only answers given after a keep decision count.';

-- ------------------------------------------------------------
-- 2. RLS — the same shape as initiatives (002 + 008): anyone in the company
-- reads, only owner/operator (can_edit_plan) writes. Writes also require the
-- initiative to belong to the same company, because a foreign key alone would
-- let a row point at another company initiative.
-- ------------------------------------------------------------
ALTER TABLE initiative_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own company initiative instances"
  ON initiative_instances;
CREATE POLICY "Users can view own company initiative instances"
  ON initiative_instances FOR SELECT
  USING (company_id = get_user_company_id());

DROP POLICY IF EXISTS "Editors can insert initiative instances"
  ON initiative_instances;
CREATE POLICY "Editors can insert initiative instances"
  ON initiative_instances FOR INSERT
  WITH CHECK (
    company_id = get_user_company_id()
    AND can_edit_plan()
    AND EXISTS (
      SELECT 1 FROM initiatives i
      WHERE i.id = initiative_id AND i.company_id = get_user_company_id()
    )
  );

DROP POLICY IF EXISTS "Editors can update initiative instances"
  ON initiative_instances;
CREATE POLICY "Editors can update initiative instances"
  ON initiative_instances FOR UPDATE
  USING (company_id = get_user_company_id() AND can_edit_plan())
  WITH CHECK (
    company_id = get_user_company_id()
    AND can_edit_plan()
    AND EXISTS (
      SELECT 1 FROM initiatives i
      WHERE i.id = initiative_id AND i.company_id = get_user_company_id()
    )
  );

DROP POLICY IF EXISTS "Editors can delete initiative instances"
  ON initiative_instances;
CREATE POLICY "Editors can delete initiative instances"
  ON initiative_instances FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ------------------------------------------------------------
-- 3. initiatives.correction_kept_at
-- ------------------------------------------------------------
ALTER TABLE initiatives
  ADD COLUMN IF NOT EXISTS correction_kept_at TIMESTAMPTZ;

COMMENT ON COLUMN initiatives.correction_kept_at IS
  'When the user last chose Keep it as planned on the skip-streak prompt. Only skips answered after it count toward the next prompt. NULL means never.';
