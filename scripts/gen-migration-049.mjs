/**
 * Generates migration 049 — the admin switch for whether new customers must
 * click a confirmation email before paying
 * (app_settings.require_email_verification).
 *
 * A GENERATOR, to match 028/029/035/037-048. The output contains no dollar
 * sign (checked on read-back). Guarded with IF NOT EXISTS, safe to re-run,
 * writes no data: the NOT NULL DEFAULT false fills the singleton row as OFF.
 *
 * Run: node scripts/gen-migration-049.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";
const DOLLAR = String.fromCharCode(36);
const sql = `-- ============================================================
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
`;
const path = "supabase/migrations/049_require_email_verification.sql";
writeFileSync(path, sql, "utf8");
const written = readFileSync(path, "utf8");
const dollars = written.split(DOLLAR).length - 1;
const checks = {
  "file matches what was generated": written === sql,
  "no DO blocks / functions":
    !/^\s*DO\b/m.test(written) && !/CREATE (OR REPLACE )?FUNCTION/i.test(written),
  "no destructive statements":
    !/DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET/i.test(written),
  "no data writes": !/^INSERT INTO/m.test(written) && !/^UPDATE /m.test(written),
  "quote-balanced outside the dash comments": (() => {
    const code = written
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    return (code.match(/'/g) || []).length % 2 === 0;
  })(),
};
console.log(`\nWrote ${path}`);
console.log(`  dollar signs          : ${dollars} (expect 0)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}
const ok = dollars === 0 && Object.values(checks).every(Boolean);
console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");
process.exit(ok ? 0 : 1);
