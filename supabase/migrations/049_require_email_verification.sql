-- ============================================================
-- REQUIRE EMAIL VERIFICATION AT SIGNUP
--
-- One switch on the app_settings singleton (020). Off (the default): new
-- customers are created already confirmed by the app's own signup route and
-- go straight from the signup form to payment, with no confirmation email.
-- On: the old flow, Supabase sends a confirmation email and the customer must
-- click it before paying. Set at /admin/subscriptions.
--
-- Code reads a missing column as OFF
-- (src/lib/auth/email-verification-setting.ts), so the release does not
-- depend on this being applied first.
-- ============================================================
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS require_email_verification BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN app_settings.require_email_verification IS
  'Whether new customers must confirm their email before paying. false (default): the app signup route creates them already confirmed and they go straight to payment. true: the old flow, Supabase sends a confirmation email first.';
