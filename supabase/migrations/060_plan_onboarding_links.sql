-- ============================================================
-- 060: PER-PLAN ONBOARDING CALENDAR LINKS
--
-- Each subscription plan can carry its own onboarding booking link for
-- monthly and for yearly purchases. The /welcome page shows the link for the
-- plan and billing cycle the customer bought (iframe and bottom button).
--
-- FALLBACK. An empty or unusable plan link falls back to the global links on
-- the Onboarding Call tab (app_settings.onboarding_call_url and
-- onboarding_call_url_yearly, 043/048). The require-call switch on that tab is
-- unchanged and still decides whether new companies are gated.
--
-- Code does not depend on this being applied. Until it is, the welcome page
-- uses the global links and the plan editor reports that the links cannot be
-- saved.
--
-- SAFE TO RE-RUN.
-- ============================================================

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS onboarding_call_url_monthly TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_call_url_yearly TEXT;

COMMENT ON COLUMN subscription_plans.onboarding_call_url_monthly IS
  'Onboarding call booking link shown on /welcome to customers on this plan billed monthly (also trials and comps on this plan). https only. NULL falls back to app_settings.onboarding_call_url.';
COMMENT ON COLUMN subscription_plans.onboarding_call_url_yearly IS
  'Onboarding call booking link shown on /welcome to customers on this plan billed yearly. https only. NULL falls back to app_settings.onboarding_call_url_yearly, then onboarding_call_url.';
