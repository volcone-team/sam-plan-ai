-- ============================================================
-- Stripe billing
--
-- Adds the state Stripe needs on top of the existing `subscriptions` and
-- `subscription_plans` tables (migrations 001 and 004), which already carry
-- tier/limit definitions and empty stripe_customer_id / stripe_subscription_id
-- columns.
--
-- DESIGN DECISIONS WORTH KNOWING BEFORE CHANGING ANYTHING HERE:
--
-- 1. TEST AND LIVE ARE SEPARATE UNIVERSES. A Stripe customer or subscription id
--    created in test mode does not exist in live mode, and vice versa. Every
--    stored id is therefore stamped with the `stripe_mode` that created it, and
--    all lookups filter on the mode currently active. Without that, flipping the
--    sandbox toggle would silently point live code at test ids (or worse) and
--    corrupt real subscriptions. Keys stay in env vars — never in this database.
--
-- 2. GRANDFATHERING IS THE DEFAULT. Stripe Prices are immutable: creating a new
--    price does not move existing subscribers onto it. So "existing users keep
--    the price they signed up at" needs no work, and "apply the new price to
--    everyone" is an explicit, audited migration action. price_id is recorded
--    per subscription so the admin UI can show who pays what.
--
-- 3. COMPED ACCESS IS FIRST-CLASS, not a hack. A super admin can grant any plan
--    to any company with no payment (an existing test account, a friend, a
--    partner). Comped companies bypass Stripe entirely but still obey their
--    plan's limits, so entitlement logic has exactly one shape.
--
-- 4. TRIALS MIRROR A REAL PLAN rather than being a fourth hidden tier. A trial
--    grants the limits of a chosen plan for a chosen number of days. Keeping a
--    separate set of trial limits in sync with the real ones is a maintenance
--    trap, and today trials have UNLIMITED access because nothing reads
--    plan_limits at all.
-- ============================================================

-- ------------------------------------------------------------
-- Platform billing settings (app_settings singleton, migration 020)
-- ------------------------------------------------------------

-- Master switch. FALSE = the app behaves exactly as it does today: signup needs
-- no payment and nothing is restricted. TRUE = payment is required to register.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS stripe_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 'test' | 'live'. Selects WHICH env key pair is used; the keys themselves are
-- never stored here. Defaults to test so a misconfigured deploy cannot take real
-- payments by accident.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS stripe_mode TEXT NOT NULL DEFAULT 'test'
  CHECK (stripe_mode IN ('test', 'live'));

-- Trial controls.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS trial_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 14
  CHECK (trial_days >= 0 AND trial_days <= 365);
-- Which plan's limits a trial grants. NULL = the plan flagged is_default.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS trial_plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL;
-- Whether Stripe Checkout collects a card before the trial starts. Card-up-front
-- converts better and deters abuse of paid AI features; card-later reduces
-- signup friction.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS trial_requires_card BOOLEAN NOT NULL DEFAULT FALSE;

-- Days a past_due subscription keeps working before access is restricted.
-- Instant lockout on a failed payment punishes customers for an expired card,
-- which is the most common cause and usually self-corrects via Stripe retries.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS dunning_grace_days INT NOT NULL DEFAULT 7
  CHECK (dunning_grace_days >= 0 AND dunning_grace_days <= 90);

-- ------------------------------------------------------------
-- Stripe price mapping
--
-- One row per (plan, cycle, mode). Separate from subscription_plans because the
-- same plan has a test price id AND a live price id, and because changing a
-- price means creating a NEW Stripe price — history must be kept so existing
-- subscribers can stay on the old one.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_prices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id         UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  stripe_mode     TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  billing_cycle   TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  stripe_product_id TEXT NOT NULL,
  stripe_price_id   TEXT NOT NULL,
  -- Minor units (cents), as Stripe reports them. Kept so the admin UI can show
  -- what a price actually is in Stripe without an API round trip.
  unit_amount     INT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'usd',
  -- FALSE once superseded by a newer price for the same plan/cycle/mode.
  -- Superseded rows are retained: grandfathered subscribers still reference them.
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_mode, stripe_price_id)
);

-- At most one current price per plan/cycle/mode.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_prices_current
  ON stripe_prices(plan_id, stripe_mode, billing_cycle)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_stripe_prices_lookup
  ON stripe_prices(stripe_mode, plan_id, billing_cycle);

-- ------------------------------------------------------------
-- Subscription columns
--
-- Extends the existing `subscriptions` table. The tier CHECK there is
-- ('starter','pro','mastery'); plan_id is added so a subscription points at the
-- actual subscription_plans row (admins can rename or add plans, and the old
-- three-value enum cannot express that).
-- ------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL;

-- Which universe the stored Stripe ids belong to. Lookups filter on this so a
-- test-mode id is never used against live mode.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_mode TEXT CHECK (stripe_mode IN ('test', 'live'));

-- The exact price this subscription is billed at. THIS is what makes
-- grandfathering work: a new price for the plan does not change this value.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- Mirrors Stripe's own status verbatim, rather than being squeezed into the
-- existing 5-value `status` column. Stripe has states that column cannot
-- express (incomplete, incomplete_expired, unpaid, paused), and losing that
-- detail means guessing whether someone should have access.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_status TEXT;

-- Billing period, straight from Stripe. Usage counters key off these so a
-- month's allowance resets when the customer is actually billed, not on the 1st.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- Set when the customer cancels but keeps access to the end of the paid period.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

-- A downgrade takes effect at period end (never mid-period — that would remove
-- access someone has paid for). This holds the pending target until then.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL;
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_billing_cycle TEXT
  CHECK (pending_billing_cycle IN ('monthly', 'annual'));

-- ---- Comped access ----
-- TRUE = full plan entitlement with no Stripe involvement. Used for the existing
-- test accounts and for deliberate grants. Kept as an explicit flag rather than
-- a fake 'active' status so "who is not paying" is answerable with one query.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS is_comped BOOLEAN NOT NULL DEFAULT FALSE;
-- NULL = comped indefinitely.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS comped_until TIMESTAMPTZ;
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS comped_reason TEXT;
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS comped_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- When dunning began, so the grace period can be measured.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub
  ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_comped
  ON subscriptions(is_comped) WHERE is_comped;

-- ------------------------------------------------------------
-- EXISTING ACCOUNTS: comp them all.
--
-- Every current row is a test entry, and switching Stripe on must not lock them
-- out. Comping is idempotent and safe to re-run.
-- ------------------------------------------------------------
UPDATE subscriptions
SET is_comped = TRUE,
    comped_reason = COALESCE(comped_reason, 'Pre-billing account (grandfathered)'),
    plan_id = COALESCE(
      plan_id,
      (SELECT id FROM subscription_plans WHERE is_default ORDER BY display_order LIMIT 1)
    )
WHERE is_comped = FALSE
  AND stripe_subscription_id IS NULL;

-- ------------------------------------------------------------
-- Invoices
--
-- Persisted from webhooks rather than fetched from Stripe on page load: the
-- admin history view must be fast and must still work when Stripe is
-- unreachable. Stripe remains the source of truth for money; this is a local
-- read model.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_invoices (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID REFERENCES companies(id) ON DELETE SET NULL,
  stripe_mode        TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  stripe_invoice_id  TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  -- draft | open | paid | uncollectible | void
  status             TEXT,
  -- Minor units. amount_due and amount_paid differ on partial/failed payment,
  -- which is exactly what a billing history needs to show.
  amount_due         INT,
  amount_paid        INT,
  currency           TEXT DEFAULT 'usd',
  description        TEXT,
  hosted_invoice_url TEXT,
  invoice_pdf        TEXT,
  period_start       TIMESTAMPTZ,
  period_end         TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  -- Populated on failure so the dashboard can explain WHY, not just "failed".
  failure_message    TEXT,
  attempt_count      INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Unique per mode, not globally: test and live id spaces are independent.
  UNIQUE (stripe_mode, stripe_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_company
  ON billing_invoices(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON billing_invoices(stripe_mode, status, created_at DESC);

-- ------------------------------------------------------------
-- Webhook event log
--
-- IDEMPOTENCY, and it is not optional. Stripe retries on any non-2xx and can
-- deliver the same event more than once even on success. Without this table a
-- retried invoice.paid could double-extend a period, and a replayed
-- subscription.updated could resurrect stale state.
--
-- The UNIQUE constraint on the event id IS the lock: the handler inserts first
-- and treats a conflict as "already handled, acknowledge and stop".
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stripe_mode     TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  stripe_event_id TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  -- Stripe's own creation time. Out-of-order delivery is normal, so handlers
  -- compare this against what they already have instead of assuming sequence.
  event_created   TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processed', 'failed', 'ignored')),
  error_message   TEXT,
  payload         JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stripe_mode, stripe_event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type
  ON stripe_webhook_events(event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_failed
  ON stripe_webhook_events(received_at DESC) WHERE status = 'failed';

-- ------------------------------------------------------------
-- Usage counters
--
-- Makes plan_limits actually mean something. Today those limits are data that
-- nothing reads, so every account has unlimited AI generations — which cost real
-- money per use.
--
-- Keyed by BILLING PERIOD, not calendar month: a customer billed on the 12th
-- should get their monthly allowance on the 12th. period_start comes from the
-- subscription, so the reset always matches what they paid for.
--
-- Deliberately NOT reset on upgrade. Someone who has used 5 of 5 Starter
-- generations and moves to Pro's 20 gets 15 more, not a fresh 20 — the ceiling
-- rises, consumption stands. Zeroing it would let a customer upgrade, downgrade
-- and repeat to get unlimited usage.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_counters (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Matches plan_limits.limit_key, e.g. 'ai_uses_month', 'plan_regenerations'.
  limit_key     TEXT NOT NULL,
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  used          INT NOT NULL DEFAULT 0 CHECK (used >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, limit_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_lookup
  ON usage_counters(company_id, limit_key, period_start DESC);

-- Atomic increment. A read-then-write from the application would race between
-- two concurrent generations and let a company exceed its cap.
CREATE OR REPLACE FUNCTION increment_usage(
  p_company_id UUID,
  p_limit_key TEXT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_amount INT DEFAULT 1
) RETURNS INT AS $$
DECLARE
  v_used INT;
BEGIN
  INSERT INTO usage_counters (company_id, limit_key, period_start, period_end, used)
  VALUES (p_company_id, p_limit_key, p_period_start, p_period_end, p_amount)
  ON CONFLICT (company_id, limit_key, period_start)
  DO UPDATE SET used = usage_counters.used + p_amount,
                updated_at = NOW()
  RETURNING used INTO v_used;
  RETURN v_used;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- RLS
--
-- Every table here is written exclusively by server routes using the
-- service-role client (checkout, the webhook handler, super-admin actions), so
-- none of them get INSERT/UPDATE policies — a client that could write these
-- could grant itself a subscription or forge an invoice.
--
-- Reads: a company may see its OWN invoices and usage, which is what the billing
-- settings page needs. stripe_prices is readable by any signed-in user so the
-- pricing page can render. The webhook log is service-role only: it contains raw
-- Stripe payloads with customer details and is an operator tool, not user data.
-- ------------------------------------------------------------
ALTER TABLE stripe_prices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stripe_prices' AND policyname = 'Authenticated can read prices'
  ) THEN
    CREATE POLICY "Authenticated can read prices"
      ON stripe_prices FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'billing_invoices' AND policyname = 'Members read own company invoices'
  ) THEN
    CREATE POLICY "Members read own company invoices"
      ON billing_invoices FOR SELECT
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'usage_counters' AND policyname = 'Members read own company usage'
  ) THEN
    CREATE POLICY "Members read own company usage"
      ON usage_counters FOR SELECT
      USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;
