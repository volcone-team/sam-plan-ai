/**
 * Generates migration 062 — the admin switch that opens or closes NEW
 * CUSTOMER REGISTRATION (app_settings.registration_open), plus a database
 * guard so a closed registration cannot be bypassed.
 *
 * A GENERATOR, because the trigger function body needs dollar quoting, which
 * shells and JS string replacement mangle. The dollar sign is built with
 * String.fromCharCode(36) and the file is read back and checked.
 *
 * WHY A DATABASE GUARD as well as the app checks: the signup page can also
 * create an account straight from the browser with the PUBLIC anon key
 * (supabase.auth.signUp, the email-verification flow). The app server never
 * sees that call, so only the database can refuse it. The guard is a BEFORE
 * INSERT trigger on auth.users that raises while registration is closed,
 * unless the account was created by the app's service role for an admin or
 * owner (raw_app_meta_data.created_by = 'admin'). A browser cannot set
 * app_metadata, so a self-signup cannot claim that exemption.
 *
 * SAFE TO RE-RUN. Writes no data: the NOT NULL DEFAULT true fills the
 * singleton row as OPEN, so nothing changes until an admin flips the switch.
 * While open the trigger returns at once.
 *
 * Run: node scripts/gen-migration-062.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";
const D = String.fromCharCode(36);
const Q = `${D}fn${D}`;
const sql = `-- ============================================================
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
AS ${Q}
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
${Q};

DROP TRIGGER IF EXISTS block_signup_when_closed ON auth.users;
CREATE TRIGGER block_signup_when_closed
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.block_signup_when_closed();
`;
const path = "supabase/migrations/062_registration_open.sql";
writeFileSync(path, sql, "utf8");
const written = readFileSync(path, "utf8");
const dollars = written.split(D).length - 1;
const checks = {
  "file matches what was generated": written === sql,
  "dollar quotes are the two fn markers": dollars === 4 && written.split(Q).length - 1 === 2,
  "no destructive statements":
    !/DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|FUNCTION)|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET/i.test(written),
  "no data writes": !/^INSERT INTO/m.test(written) && !/^UPDATE /m.test(written),
  "trigger is BEFORE INSERT on auth.users": /BEFORE INSERT ON auth\.users/.test(written),
  "quote-balanced outside the dash comments": (() => {
    const code = written
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    return (code.match(/'/g) || []).length % 2 === 0;
  })(),
};
console.log(`\nWrote ${path}`);
console.log(`  dollar signs          : ${dollars} (expect 4)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");
process.exit(ok ? 0 : 1);
