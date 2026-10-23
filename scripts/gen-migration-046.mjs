/**
 * Generates migration 046 — per-run rows for recurring initiatives.
 *
 * A GENERATOR, not a hand-written .sql file, to match 028/029/035/037-045.
 * The output contains NO dollar sign: no dollar-quoting, no DO blocks, no
 * functions. It reuses update_updated_at() from 001 instead of defining a new
 * function, and guards policies with DROP POLICY IF EXISTS + CREATE POLICY as
 * 045 does. The read-back check below asserts there is no dollar in the file,
 * because PowerShell expands a doubled dollar to its PID and JS replace()
 * treats it specially.
 *
 * Every statement is guarded (IF NOT EXISTS, DROP ... IF EXISTS before each
 * ADD CONSTRAINT / CREATE POLICY / CREATE TRIGGER), so it is safe to re-run.
 * It writes no data.
 *
 * Run: node scripts/gen-migration-046.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

/** Built, never typed. Used only to count dollars in the read-back. */
const DOLLAR = String.fromCharCode(36);

const OUTCOMES = ["ran", "skipped", "not-yet"];
const OUTCOME_LIST = OUTCOMES.map((o) => `'${o}'`).join(", ");

const sql = `-- ============================================================
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
  CHECK (outcome IS NULL OR outcome IN (${OUTCOME_LIST}));

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
`;

const path = "supabase/migrations/046_recurring_instances.sql";
writeFileSync(path, sql, "utf8");

/* ---- Read back from disk and check what was actually written ---- */
const written = readFileSync(path, "utf8");
const dollars = written.split(DOLLAR).length - 1;
const count = (re) => (written.match(re) || []).length;
const checks = {
  "file matches what was generated": written === sql,
  "every ADD CONSTRAINT preceded by a DROP IF EXISTS":
    count(/ADD CONSTRAINT/g) === count(/DROP CONSTRAINT IF EXISTS/g),
  "every CREATE POLICY preceded by a DROP IF EXISTS":
    count(/CREATE POLICY/g) === count(/DROP POLICY IF EXISTS/g),
  "no DO blocks / functions":
    !/^\s*DO\b/m.test(written) && !/CREATE (OR REPLACE )?FUNCTION/i.test(written),
  "no destructive statements":
    !/DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT(?!\s+IF\b))|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET/i.test(written),
  "no data writes": count(/^INSERT INTO/gm) === 0 && count(/^UPDATE /gm) === 0,
  "quote-balanced outside the dash comments": (() => {
    const code = written
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    return (code.match(/'/g) || []).length % 2 === 0;
  })(),
};

console.log(`\nWrote ${path}`);
console.log(`  dollar signs          : ${dollars} (expect 0)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}
const ok = dollars === 0 && Object.values(checks).every(Boolean);
console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");
process.exit(ok ? 0 : 1);
