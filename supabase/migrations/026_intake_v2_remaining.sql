-- ============================================================
-- INTAKE v2, part 2 — the fields migration 025 did not cover
--
-- 025 landed the bulk of the redesigned intake. Reading the client spec against
-- it turned up six more fields plus the analytics sink, all additive.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

-- ------------------------------------------------------------
-- 1. planning_inputs
-- ------------------------------------------------------------

ALTER TABLE planning_inputs
  -- Screen 1: the text revealed when business_industry is "Other". Kept
  -- separate from `industry` so the 13 canonical values stay clean enough for
  -- the generator to filter on — mixing free text into that column would break
  -- matching against the Initiative Library's Ideal Industries.
  ADD COLUMN IF NOT EXISTS industry_other TEXT,

  /*
   * Save-and-resume position.
   *
   * A SCREEN SLUG, never an index. Path C has 9 screens and Paths A and B have
   * 10, so index 5 is a different screen depending on the path — a user who
   * changed their screen-0 answer would resume somewhere they had never been.
   * A slug is unambiguous, and an unknown slug can simply fall back to the
   * start instead of landing on the wrong question.
   */
  ADD COLUMN IF NOT EXISTS resume_screen TEXT,

  -- Lifecycle, with a timestamp per state so the funnel can be measured rather
  -- than inferred. The spec requires all five.
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT
    CHECK (onboarding_status IN (
      'signed_up', 'intake_started', 'intake_complete',
      'plan_viewed', 'first_actuals_entered'
    )),
  ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_complete_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_actuals_at TIMESTAMPTZ;

COMMENT ON COLUMN planning_inputs.resume_screen IS
  'Screen SLUG to resume at (not an index — paths have different lengths).';

COMMENT ON COLUMN planning_inputs.industry_other IS
  'Free text for "Other". `industry` keeps only the 13 canonical values so the generator can filter on it.';

-- ------------------------------------------------------------
-- 2. intake_products
-- ------------------------------------------------------------

ALTER TABLE intake_products
  -- Only meaningful when payment_type = 'recurring', which reveals the
  -- "per month" / "per year" choice. Nullable because one-time and payment-plan
  -- products have no interval, and a default would imply one.
  ADD COLUMN IF NOT EXISTS recurring_interval TEXT
    CHECK (recurring_interval IN ('month', 'year'));

COMMENT ON COLUMN intake_products.recurring_interval IS
  'Billing interval for recurring products. NULL for one-time and payment-plan.';

-- ------------------------------------------------------------
-- 3. intake_initiatives
-- ------------------------------------------------------------

ALTER TABLE intake_initiatives
  -- The "Something else" free text from the picker. The spec flags these for
  -- review: a customer naming an initiative the library does not carry is a
  -- signal about what the library is missing, which is lost if it is discarded.
  ADD COLUMN IF NOT EXISTS custom_label TEXT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_intake_initiatives_review
  ON intake_initiatives(needs_review)
  WHERE needs_review = TRUE;

COMMENT ON COLUMN intake_initiatives.custom_label IS
  'Free text from "Something else". Flagged via needs_review so the library gap can be reviewed.';

-- ------------------------------------------------------------
-- 4. intake_events — the analytics sink
--
-- Internal rather than a third-party tool: no new secret to manage, no vendor
-- dependency, and the admin report can query it directly. Follows the same
-- shape as generation_events.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Nullable: screen 0 can fire before a company is resolved on a brand-new
  -- signup, and losing that event would bias the very funnel being measured.
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID,

  event       TEXT NOT NULL,
  screen      TEXT,
  plan_path   TEXT,

  /*
   * Event-specific extras: field, seconds_on_screen, initiative_type, source,
   * action, initiative_count, gap_amount.
   *
   * JSONB because the 11 events carry different shapes — a column per property
   * would be mostly NULL and would need a migration every time an event gains
   * a property.
   */
  properties  JSONB NOT NULL DEFAULT '{}',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Funnel queries read by event and time; the admin report groups by path.
CREATE INDEX IF NOT EXISTS idx_intake_events_event
  ON intake_events(event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intake_events_company
  ON intake_events(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intake_events_path
  ON intake_events(plan_path, screen);

-- ------------------------------------------------------------
-- 5. Row level security on intake_events
--
-- Writes arrive through an API route using the service role, which bypasses
-- RLS. These policies cover direct client reads: a member may see their own
-- company's events and nothing else.
-- ------------------------------------------------------------
ALTER TABLE intake_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intake_events'
      AND policyname = 'Members read own company intake events'
  ) THEN
    CREATE POLICY "Members read own company intake events"
      ON intake_events FOR SELECT
      USING (company_id = get_user_company_id());
  END IF;
END $$;
