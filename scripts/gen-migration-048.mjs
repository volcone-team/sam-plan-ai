/**
 * Generates migration 048 — a second onboarding booking link, for customers on
 * a yearly plan (app_settings.onboarding_call_url_yearly).
 *
 * A GENERATOR, to match 028/029/035/037-047. The output contains no dollar
 * sign (checked on read-back). Guarded with IF NOT EXISTS, safe to re-run,
 * writes no data: the new column is nullable, and NULL means "use the monthly
 * link", so applying it changes nothing a customer sees.
 *
 * Run: node scripts/gen-migration-048.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

const DOLLAR = String.fromCharCode(36);

const sql = `-- ============================================================
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
`;

const path = "supabase/migrations/048_yearly_booking_link.sql";
writeFileSync(path, sql, "utf8");

const written = readFileSync(path, "utf8");
const dollars = written.split(DOLLAR).length - 1;
const checks = {
  "file matches what was generated": written === sql,
  "adds the column idempotently": written.includes(
    "ADD COLUMN IF NOT EXISTS onboarding_call_url_yearly TEXT;"
  ),
  "has the column comment": written.includes(
    "COMMENT ON COLUMN app_settings.onboarding_call_url_yearly IS"
  ),
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
