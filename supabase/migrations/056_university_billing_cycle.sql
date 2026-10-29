-- ============================================================
-- SAM UNIVERSITY: SHOW A RESOURCE BY BILLING CYCLE
--
-- Resources were gated by plan only (is_free / university_resource_plans,
-- migration 038). Some content is for ANNUAL payers only — e.g. three courses
-- for both Starter and Pro on the annual plan — and a plan list cannot say
-- that, because one plan is sold both monthly and yearly.
--
-- billing_cycle:
--   'any'     shown to everyone the plan rules allow (the default, so every
--             existing resource behaves exactly as before)
--   'annual'  shown only to companies paying annually
--   'monthly' shown only to companies paying monthly
--
-- It is a VISIBILITY rule, applied on top of the plan rule: a resource for the
-- other cycle is HIDDEN from the customer, not shown locked. Super admins and
-- "billing switched off" still see everything. Trials and comped accounts
-- count as monthly (only a paid subscription's cycle is real; see
-- src/lib/billing/booking.ts onboardingBookingCycle).
--
-- Same vocabulary as subscriptions.billing_cycle ('monthly' | 'annual').
--
-- SAFE TO RE-RUN: every statement is guarded. No data is changed.
-- ============================================================

ALTER TABLE university_resources
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'any';

ALTER TABLE university_resources
  DROP CONSTRAINT IF EXISTS university_resources_billing_cycle_check;

ALTER TABLE university_resources
  ADD CONSTRAINT university_resources_billing_cycle_check
  CHECK (billing_cycle IN ('any', 'monthly', 'annual'));

COMMENT ON COLUMN university_resources.billing_cycle IS
  'Who sees it by billing cycle: any | monthly | annual. Applied on top of the plan rule; the other cycle does not see the resource at all. Super admins and billing-disabled see everything.';
