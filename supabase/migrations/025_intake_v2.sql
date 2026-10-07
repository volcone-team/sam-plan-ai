-- ============================================================
-- INTAKE v2 — the redesigned questionnaire
--
-- The new intake collects roughly twice the data of the old one, and most of it
-- has no column to live in. `planning_inputs` (migration 001) has FIXED columns
-- matching the original 7-step form, so the new screens need somewhere to go.
--
-- SHAPE OF THIS MIGRATION. Scalar answers become columns on `planning_inputs`;
-- the two REPEATING sections become their own tables:
--
--   intake_products    — screen 3, one row per product (7 fields each, and the
--                        plan's revenue is derived from them)
--   intake_initiatives — screens 5 and 6, one row per initiative the user
--                        already runs or has tried, each with its own funnel
--
-- Why tables rather than JSONB: both are queried and aggregated (products drive
-- the revenue total, initiatives drive the forecast and the gap-to-goal bar),
-- and both become real `products` / `initiatives` rows at generation time. A
-- JSONB blob would make that mapping untyped and unqueryable.
--
-- Funnel percentages are stored per initiative because STAGE LABELS differ by
-- type — a webinar runs registered/showed/bought, a podcast spot runs
-- opted-in/booked-a-call/bought — while the arithmetic is identical. Storing
-- them as an ordered JSONB array of {key,label,percent} keeps one schema for
-- every initiative in the library instead of a column per possible stage.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New scalar answers on planning_inputs.
--
-- All nullable with no defaults that imply an answer. A 0 where the user said
-- nothing would be indistinguishable from a real zero, and several of these
-- feed the AI prompt — "team of 0" is worse than "unknown".
-- ------------------------------------------------------------

ALTER TABLE planning_inputs
  -- Screen 0: which path the user chose. Changes the emphasis of screens 5-6
  -- and how much the AI is expected to contribute.
  ADD COLUMN IF NOT EXISTS intake_path TEXT
    CHECK (intake_path IN ('know_most', 'know_some', 'recommend_all')),

  -- Screen 1: your business
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS prior_period_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS purchase_mode TEXT
    CHECK (purchase_mode IN ('self_serve', 'sales_call', 'in_person', 'mix')),
  ADD COLUMN IF NOT EXISTS growth_stage TEXT
    CHECK (growth_stage IN ('start', 'momentum', 'scale')),

  -- Screen 2: team and time. `team_size` and `monthly_marketing_budget`
  -- already exist from migration 001 and are reused as-is.
  ADD COLUMN IF NOT EXISTS sales_owner TEXT
    CHECK (sales_owner IN ('me', 'salesperson', 'no_sales_calls', 'mix')),
  ADD COLUMN IF NOT EXISTS plan_owner TEXT
    CHECK (plan_owner IN ('me', 'team_member', 'both')),
  ADD COLUMN IF NOT EXISTS weekly_hours INT
    CHECK (weekly_hours IS NULL OR (weekly_hours >= 0 AND weekly_hours <= 168)),

  -- Screen 3: planning horizon. `revenue_timeframe` from 001 allows only
  -- 3/6/12; the new form offers 18 as well, so this replaces it rather than
  -- widening a constraint other code already depends on.
  ADD COLUMN IF NOT EXISTS horizon_months INT
    CHECK (horizon_months IN (3, 6, 12, 18)),
  -- First month of the plan, stored as a DATE on the 1st. A plan can start in
  -- a future month, so this is not derivable from created_at.
  ADD COLUMN IF NOT EXISTS plan_start_month DATE,

  -- Screen 6: free-text reflections, kept separate from the structured
  -- what-worked / what-failed initiative lists.
  ADD COLUMN IF NOT EXISTS what_worked_notes TEXT,
  ADD COLUMN IF NOT EXISTS what_failed_notes TEXT,

  -- Screen 7: who you sell to
  ADD COLUMN IF NOT EXISTS sells_to TEXT
    CHECK (sells_to IN ('businesses', 'consumers', 'both')),
  ADD COLUMN IF NOT EXISTS customer_industries TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS problem_solved TEXT,

  -- Screen 8: audience today.
  --
  -- Each figure has a matching `_unknown` flag because the form offers an
  -- explicit "Not sure" checkbox. NULL alone cannot carry that: it means both
  -- "skipped" and "deliberately unknown", and the AI should treat an admitted
  -- unknown differently from an unanswered field.
  ADD COLUMN IF NOT EXISTS email_list_size INT,
  ADD COLUMN IF NOT EXISTS email_list_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS social_following INT,
  ADD COLUMN IF NOT EXISTS social_following_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS monthly_visitors INT,
  ADD COLUMN IF NOT EXISTS monthly_visitors_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS past_customers INT,
  ADD COLUMN IF NOT EXISTS past_customers_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS monthly_leads INT,
  ADD COLUMN IF NOT EXISTS monthly_leads_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS borrowed_audiences TEXT[] DEFAULT '{}',

  -- Screen 9: obstacles. The form caps the selection at 3; enforced in the UI
  -- and re-checked server-side rather than by a constraint, so a future change
  -- to the cap does not need a migration.
  ADD COLUMN IF NOT EXISTS challenges TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS challenge_notes TEXT,

  -- Which intake version produced this row. Lets the generator read v2 answers
  -- without guessing from which columns happen to be populated.
  ADD COLUMN IF NOT EXISTS intake_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN planning_inputs.intake_version IS
  '1 = original 7-step questionnaire, 2 = redesigned 11-screen intake.';

COMMENT ON COLUMN planning_inputs.email_list_unknown IS
  'TRUE when the user ticked "Not sure". Distinct from a NULL size, which means unanswered.';

-- ------------------------------------------------------------
-- 2. Products (screen 3)
--
-- The plan's revenue target is derived from these rows (average price x units),
-- so they are queried and summed rather than just stored.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_products (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  planning_input_id UUID NOT NULL REFERENCES planning_inputs(id) ON DELETE CASCADE,

  name              TEXT NOT NULL,
  product_type      TEXT CHECK (product_type IN (
                      'coaching_service', 'course', 'membership', 'event',
                      'digital_product', 'physical_product', 'other'
                    )),
  price_level       TEXT CHECK (price_level IN ('low', 'mid', 'high', 'one_to_one')),
  payment_type      TEXT CHECK (payment_type IN ('one_time', 'recurring', 'payment_plan')),
  delivery_mode     TEXT CHECK (delivery_mode IN ('online', 'in_person', 'shipped', 'hybrid')),

  -- The REAL average after discounts, not the list price. Planning off list
  -- price overstates every figure derived from it.
  average_price     NUMERIC(12,2),
  units_in_period   INT,

  display_order     INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_products_input
  ON intake_products(planning_input_id, display_order);

CREATE INDEX IF NOT EXISTS idx_intake_products_company
  ON intake_products(company_id);

-- ------------------------------------------------------------
-- 3. Initiatives (screens 5 and 6)
--
-- ONE table for both screens, separated by `source`:
--   'planned' — screen 5, things they intend to run
--   'worked'  — screen 6, what has driven sales before
--   'failed'  — screen 6, what they tried that did not work
--
-- They share every field that matters (library key, funnel, price), and the
-- generator reads all three: planned initiatives become real rows, while
-- worked/failed steer what it recommends. Three near-identical tables would
-- have meant three code paths for the same shape.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_initiatives (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  planning_input_id UUID NOT NULL REFERENCES planning_inputs(id) ON DELETE CASCADE,

  source            TEXT NOT NULL DEFAULT 'planned'
                      CHECK (source IN ('planned', 'worked', 'failed')),

  -- Key into wb_initiative_library. NOT a foreign key: the workbook is
  -- re-uploadable and a key can disappear between uploads, which must not
  -- delete a customer's intake answers. Resolved at read time, like the
  -- generator already does for grandfathered keys.
  initiative_key    TEXT NOT NULL,
  -- Name as shown when answered, so a renamed library entry does not silently
  -- change what the user said.
  initiative_label  TEXT,

  -- Which products this initiative sells. UUIDs into intake_products; an array
  -- because screen 5 allows several per initiative.
  product_ids       UUID[] DEFAULT '{}',

  cadence           TEXT CHECK (cadence IN ('once', 'repeat', 'always_on')),
  repeat_frequency  TEXT CHECK (repeat_frequency IN ('weekly', 'monthly', 'quarterly')),

  -- Timing is EITHER a month or an exact date — screen 5 toggles between them.
  -- Both nullable: the copy says timing is optional and can be set later on the
  -- calendar.
  start_month       DATE,
  exact_date        DATE,

  has_run_before    BOOLEAN,

  -- Funnel inputs. `audience_reached` and `average_price` are the two ends;
  -- `funnel_stages` is an ordered array of {key, label, percent} between them.
  -- Stage labels vary by initiative type while the arithmetic does not, so one
  -- JSONB array serves every library entry.
  audience_reached  INT,
  funnel_stages     JSONB NOT NULL DEFAULT '[]',
  average_price     NUMERIC(12,2),

  -- Screen 6 only: why a failed initiative did not work.
  failure_reason    TEXT,

  display_order     INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_initiatives_input
  ON intake_initiatives(planning_input_id, source, display_order);

CREATE INDEX IF NOT EXISTS idx_intake_initiatives_company
  ON intake_initiatives(company_id);

-- ------------------------------------------------------------
-- 4. Row level security
--
-- Same shape as planning_inputs in migration 002: company-scoped through
-- get_user_company_id(). Without these, RLS being enabled would reject every
-- read and the intake would silently save nothing.
-- ------------------------------------------------------------
ALTER TABLE intake_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_initiatives ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intake_products' AND policyname = 'Members manage own intake products'
  ) THEN
    CREATE POLICY "Members manage own intake products"
      ON intake_products FOR ALL
      USING (company_id = get_user_company_id())
      WITH CHECK (company_id = get_user_company_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intake_initiatives' AND policyname = 'Members manage own intake initiatives'
  ) THEN
    CREATE POLICY "Members manage own intake initiatives"
      ON intake_initiatives FOR ALL
      USING (company_id = get_user_company_id())
      WITH CHECK (company_id = get_user_company_id());
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. updated_at triggers, matching the convention in 001.
-- ------------------------------------------------------------
-- The function is `update_updated_at` (migration 001), NOT
-- `update_updated_at_column` — the name the rest of the ecosystem uses. Guarded
-- anyway so a missing function skips the triggers with a notice rather than
-- aborting the whole migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS set_intake_products_updated_at ON intake_products;
    CREATE TRIGGER set_intake_products_updated_at
      BEFORE UPDATE ON intake_products
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

    DROP TRIGGER IF EXISTS set_intake_initiatives_updated_at ON intake_initiatives;
    CREATE TRIGGER set_intake_initiatives_updated_at
      BEFORE UPDATE ON intake_initiatives
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  ELSE
    RAISE NOTICE 'update_updated_at() not found - skipped intake updated_at triggers';
  END IF;
END $$;
