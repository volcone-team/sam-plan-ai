-- ============================================================
-- 061: INITIATIVE TARGETS FROM UNITS x PRICE, RECURRING PER OCCURRENCE,
--      PRODUCT GOALS, TASK TEMPLATE SECTIONS
--
-- Client, Oct 2026 ("Initiative Target Setting" dev spec, Phase 1, plus the
-- recurring and task-template transcripts). Columns only; every one is
-- NULLABLE and nothing existing is changed, so the app behaves exactly as it
-- did until the code that reads them ships. The code treats a missing column
-- as "feature off", so it may also deploy BEFORE this is applied.
--
-- initiatives
--   units_goal              Units the user expects to sell. For a RECURRING
--                           initiative this is PER OCCURRENCE (client: "I'm
--                           going to make $75,000 per webinar, not in total").
--   unit_price_at_set       The product's price when the target was set. A
--                           later price change does not silently move Good.
--   target_source           suggested | edited | migrated. Measures how often
--                           users override the suggestion (Phase 2 flywheel).
--   revenue_per_occurrence  Good for ONE occurrence of a recurring initiative.
--                           revenue_good stays the plan total (per occurrence
--                           x occurrences), which every total already sums.
--   last_occurrence_date    When the occurrences end. Replaces the close date
--                           as what bounds a series, so one webinar's cart
--                           closing no longer ends the whole series.
--
-- products
--   goal_units              The intake's "how many do you want to sell" for
--                           this product. The product goal = price x units;
--                           it was lost after the build, so manual add had no
--                           goal to share.
--
-- wb_task_templates
--   section                 The section heading a template row sat under in
--                           the workbook ("Opt-in Funnels", "Meta Ads",
--                           "If approved for selling on stage"). Lets intake
--                           answers pick the sections that apply.
--
-- SAFE TO RE-RUN: every statement is guarded. No data is changed.
-- ============================================================

-- ---- initiatives ------------------------------------------------------

ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS units_goal INTEGER;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS unit_price_at_set NUMERIC(12,2);
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS target_source TEXT;
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS revenue_per_occurrence NUMERIC(12,2);
ALTER TABLE initiatives ADD COLUMN IF NOT EXISTS last_occurrence_date DATE;

ALTER TABLE initiatives DROP CONSTRAINT IF EXISTS initiatives_units_goal_check;
ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_units_goal_check
  CHECK (units_goal IS NULL OR units_goal >= 0);

ALTER TABLE initiatives DROP CONSTRAINT IF EXISTS initiatives_unit_price_at_set_check;
ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_unit_price_at_set_check
  CHECK (unit_price_at_set IS NULL OR unit_price_at_set >= 0);

ALTER TABLE initiatives DROP CONSTRAINT IF EXISTS initiatives_target_source_check;
ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_target_source_check
  CHECK (target_source IS NULL OR target_source IN ('suggested', 'edited', 'migrated'));

ALTER TABLE initiatives DROP CONSTRAINT IF EXISTS initiatives_revenue_per_occurrence_check;
ALTER TABLE initiatives
  ADD CONSTRAINT initiatives_revenue_per_occurrence_check
  CHECK (revenue_per_occurrence IS NULL OR revenue_per_occurrence >= 0);

COMMENT ON COLUMN initiatives.units_goal IS
  'Units expected to sell. Per occurrence for a recurring initiative, else for the plan. NULL = target set before migration 061 (dollars only).';
COMMENT ON COLUMN initiatives.unit_price_at_set IS
  'Product price snapshot when the target was set; Good does not move when the product price changes later.';
COMMENT ON COLUMN initiatives.target_source IS
  'suggested | edited | migrated: whether the units were the app suggestion, changed by the user, or converted from an older dollar target.';
COMMENT ON COLUMN initiatives.revenue_per_occurrence IS
  'Good for one occurrence of a recurring initiative. revenue_good = this x occurrences in the plan.';
COMMENT ON COLUMN initiatives.last_occurrence_date IS
  'Last occurrence of a recurring initiative. Bounds the series; NULL = until the plan ends.';

-- ---- products ---------------------------------------------------------

ALTER TABLE products ADD COLUMN IF NOT EXISTS goal_units INTEGER;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_goal_units_check;
ALTER TABLE products
  ADD CONSTRAINT products_goal_units_check
  CHECK (goal_units IS NULL OR goal_units >= 0);

COMMENT ON COLUMN products.goal_units IS
  'Units the user wants to sell in the plan period (from the intake). Product goal = price x goal_units. NULL = no product goal.';

-- ---- wb_task_templates -----------------------------------------------

ALTER TABLE wb_task_templates ADD COLUMN IF NOT EXISTS section TEXT;

COMMENT ON COLUMN wb_task_templates.section IS
  'Workbook section heading the task sat under (e.g. "Opt-in Funnels", "Meta Ads"). NULL = no heading.';
