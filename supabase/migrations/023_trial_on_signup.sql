-- ============================================================
-- Trial starts at signup, and initiatives are capped during it
--
-- FIXES A REAL BUG: handle_new_user() (migration 005) created a company, a
-- profile and an annual_plan but NEVER a `subscriptions` row. Every account
-- therefore had no billing record at all, which is why the settings page said
-- "You do not have an active plan yet" and why checkout could not attach a
-- customer to anything.
--
-- CHANGES THE TRIAL MODEL. Previously a trial was a Stripe trial, which meant it
-- only began when someone started checkout — so a new user had no trial and no
-- plan. Now the trial is LOCAL state granted at signup:
--
--   * Registration immediately starts a <trial_days>-day trial.
--   * During the trial the account may create at most <trial_initiative_cap>
--     initiatives (default 3), counting quickstart and full together.
--   * When the trial ends they can view the dashboard but not create more.
--   * Paying for a plan replaces the trial with that plan's real limits.
--
-- Stripe trials are no longer used, so the plan cards say "Upgrade to this plan"
-- rather than "Start trial" — by the time anyone sees them the trial is already
-- running.
-- ============================================================

-- How many initiatives a trial account may create in total. Admin-configurable;
-- 3 by default. Counted for the WHOLE trial, not per month, because a trial is a
-- one-off evaluation window rather than a billing period.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS trial_initiative_cap INT NOT NULL DEFAULT 3
  CHECK (trial_initiative_cap >= 0 AND trial_initiative_cap <= 1000);

-- ------------------------------------------------------------
-- Backfill: give every existing company a subscriptions row.
--
-- These are pre-billing accounts, so they are comped (migration 022's rationale)
-- rather than being dropped into an expired trial.
-- ------------------------------------------------------------
INSERT INTO subscriptions (
  company_id, tier, status, billing_cycle,
  is_trial_active, is_comped, comped_reason, plan_id, start_date
)
SELECT
  c.id,
  'starter',
  'active',
  'monthly',
  FALSE,
  TRUE,
  'Pre-billing account (grandfathered)',
  (SELECT id FROM subscription_plans WHERE is_default ORDER BY display_order LIMIT 1),
  NOW()
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.company_id = c.id);

-- ------------------------------------------------------------
-- Signup trigger: also create the subscription, on trial.
--
-- Reads trial settings at insert time so changing them in the admin panel
-- affects the next signup without a redeploy. Falls back to 14 days / cap 3 if
-- the settings row is somehow missing, so signup can never fail over billing
-- configuration — a broken trial setting must not stop people registering.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id UUID;
  v_company_name TEXT;
  v_first TEXT;
  v_last TEXT;
  v_trial_enabled BOOLEAN;
  v_trial_days INT;
  v_trial_plan UUID;
BEGIN
  v_first := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
  v_last  := COALESCE(NEW.raw_user_meta_data->>'last_name', '');
  v_company_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    v_first || E'\x27' || 's Company'
  );

  INSERT INTO companies (name, description, fiscal_year, planning_year, currency)
  VALUES (
    v_company_name, '',
    EXTRACT(YEAR FROM NOW())::INT,
    EXTRACT(YEAR FROM NOW())::INT,
    'USD'
  )
  RETURNING id INTO new_company_id;

  INSERT INTO profiles (id, company_id, email, first_name, last_name, role, is_admin)
  VALUES (NEW.id, new_company_id, NEW.email, v_first, v_last, 'owner', FALSE);

  INSERT INTO annual_plans (company_id, year, baseline_revenue, stretch_revenue, operating_budget, status)
  VALUES (new_company_id, EXTRACT(YEAR FROM NOW())::INT, 0, 0, 0, 'draft');

  SELECT
    COALESCE(trial_enabled, TRUE),
    COALESCE(NULLIF(trial_days, 0), 14),
    trial_plan_id
  INTO v_trial_enabled, v_trial_days, v_trial_plan
  FROM app_settings WHERE id = 'global';

  v_trial_enabled := COALESCE(v_trial_enabled, TRUE);
  v_trial_days    := COALESCE(v_trial_days, 14);
  v_trial_plan    := COALESCE(
    v_trial_plan,
    (SELECT id FROM subscription_plans WHERE is_default ORDER BY display_order LIMIT 1)
  );

  INSERT INTO subscriptions (
    company_id, tier, status, billing_cycle, plan_id,
    is_trial_active, trial_ends_at, start_date
  )
  VALUES (
    new_company_id,
    'starter',
    CASE WHEN v_trial_enabled THEN 'trial' ELSE 'cancelled' END,
    'monthly',
    v_trial_plan,
    v_trial_enabled,
    CASE WHEN v_trial_enabled THEN NOW() + (v_trial_days || ' days')::INTERVAL ELSE NULL END,
    NOW()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
