-- ============================================================
-- YEARLY ONBOARDING BOOKING LINK
--
-- onboarding_call_url (043) stays as it is and is now the MONTHLY link, also
-- used for trials, comped accounts and anyone without a paid subscription.
-- This adds a second link for customers whose subscription is billed yearly
-- (subscriptions.billing_cycle = 'annual').
--
-- NULL (the default) falls back to the monthly link, so nothing changes until
-- an admin fills it in. Both are edited on the Onboarding tab of
-- /admin/subscriptions and chosen per customer by
-- resolveOnboardingBookingUrl (src/lib/billing/booking.ts).
--
-- Code reads a missing column as "no yearly link"
-- (src/lib/access/call-gate-settings.ts), so the release does not depend on
-- this being applied first.
-- ============================================================

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS onboarding_call_url_yearly TEXT;

COMMENT ON COLUMN app_settings.onboarding_call_url_yearly IS
  'Onboarding call booking link for customers on a yearly (annual) plan, shown on the thank-you page. Any https URL. NULL or unusable falls back to onboarding_call_url, which serves monthly plans, trials and comped accounts.';
