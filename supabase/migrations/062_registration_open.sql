-- ============================================================
-- 062: OPEN / CLOSE NEW CUSTOMER REGISTRATION
--
-- app_settings.registration_open (default true = open). Set at
-- /admin/settings. Closed: /auth/signup and /get-started show a "not
-- accepting new registrations" notice, POST /api/auth/signup creates
-- nothing, and the trigger below refuses any other self-signup.
--
-- NOT affected: existing accounts (sign in, pay, renew), team invites,
-- and users / companies an admin creates. Those are created by the app's
-- service role with raw_app_meta_data.created_by = 'admin'.
--
-- Code reads a missing column as OPEN (src/lib/auth/registration-setting.ts),
-- so the release does not depend on this being applied first.
-- ============================================================
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS registration_open BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN app_settings.registration_open IS
  'Whether new customers can register. true (default): open. false: self-signup is refused by the app and by the auth.users trigger block_signup_when_closed; admin-created users and team invites still work.';

-- ------------------------------------------------------------
-- Guard: refuse a self-signup while registration is closed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_signup_when_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  is_open boolean;
BEGIN
  -- Created by the app for an admin or an owner (team invite): always allowed.
  IF COALESCE(NEW.raw_app_meta_data ->> 'created_by', '') = 'admin' THEN
    RETURN NEW;
  END IF;

  SELECT registration_open INTO is_open FROM public.app_settings WHERE id = 'global';

  -- Only an explicit false closes registration; no row or NULL stays open.
  IF is_open IS FALSE THEN
    RAISE EXCEPTION 'registration_closed'
      USING HINT = 'New registrations are closed (app_settings.registration_open = false).';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS block_signup_when_closed ON auth.users;
CREATE TRIGGER block_signup_when_closed
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_signup_when_closed();
