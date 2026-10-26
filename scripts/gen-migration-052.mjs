/**
 * Generates migration 052 — ghl_events.event_type accepts 'registered'.
 *
 * A GENERATOR, to match 028/029/035/037-051. The DO block's dollar quotes are
 * built with String.fromCharCode(36) so no shell or JS replace() can mangle
 * them, and the file is read back to check.
 *
 * 044 declared the CHECK inline, so its name is whatever Postgres chose
 * (normally ghl_events_event_type_check). The DO block drops every CHECK on
 * ghl_events whose definition mentions event_type, whatever it is called,
 * then the widened CHECK is added under the default name.
 *
 * Re-runnable. Writes no data. Only WIDENS: every existing row still passes.
 *
 * Run: node scripts/gen-migration-052.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

const DOLLAR = String.fromCharCode(36);
const DQ = DOLLAR + DOLLAR;

/** 044's list, in 044's order, plus 'registered'. Must match GhlEventType + login_trigger. */
const EVENT_TYPES = [
  "buyer_state",
  "founder",
  "cancellation",
  "finished_intake",
  "plan_generated",
  "first_login",
  "login_trigger",
  "marketing_suppression",
  "registered",
];
const LIST = EVENT_TYPES.map((t) => `'${t}'`).join(", ");
const NAME = "ghl_events_event_type_check";

const sql = `-- ============================================================
-- 052: GHL 'registered' EVENT
--
-- ghl_events.event_type (044) gains 'registered': a company owner signed up
-- through the public signup and has not paid. Producer:
-- src/lib/ghl/producers/registration.ts. Tags:
--   sam plan ai app - registered - not - paid   (always)
--   sam plan ai app - buyer - opted - dnd       (promotional consent unticked)
--
-- 044 declared the CHECK inline, so the DO block drops every CHECK on
-- ghl_events whose definition mentions event_type, by definition, and the
-- widened one is re-added as ${NAME}.
--
-- Code does not depend on this being applied: until it is, the insert is
-- refused with 23514 and the producer reports "not delivered" without
-- affecting signup or /api/me.
--
-- Writes no data. Safe to re-run.
-- ============================================================

-- 1. Drop the existing event_type CHECK, whatever it is called.
DO ${DQ}
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid = to_regclass('public.ghl_events')
       AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE ghl_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
${DQ};

-- 2. The widened CHECK.
ALTER TABLE ghl_events
  DROP CONSTRAINT IF EXISTS ${NAME};
ALTER TABLE ghl_events
  ADD CONSTRAINT ${NAME}
  CHECK (event_type IN (${LIST}));

COMMENT ON COLUMN ghl_events.event_type IS
  'What happened, not what to write (the tags columns say that). buyer_state: purchase or tier change - one buyer tag added, the others removed (entering active also removes registered - not - paid). founder: founding-member cohort, add only. cancellation: subscription ended. finished_intake / plan_generated: lifecycle milestones. first_login: one-shot, guarded by profiles.ghl_first_login_at. login_trigger: dropped by the client, nothing enqueues it. marketing_suppression: the Customer - SAM Plan AI tag in the ayr / 10x accounts. registered (052): one per company, owner signed up through the public signup and has not paid - adds registered - not - paid, plus buyer - opted - dnd when promotional consent was refused.';
`;

const path = "supabase/migrations/052_ghl_registered_event.sql";
writeFileSync(path, sql, "utf8");

const written = readFileSync(path, "utf8");
const dollars = written.split(DOLLAR).length - 1;
const code = written
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

const checks = {
  "file matches what was generated": written === sql,
  "exactly one DO block, opened and closed with $$":
    dollars === 4 && /^DO \$\$$/m.test(written) && /^\$\$;$/m.test(written),
  "no functions created": !/CREATE (OR REPLACE )?FUNCTION/i.test(written),
  "no table/column/index drops or data deletes":
    !/DROP\s+(TABLE|COLUMN|INDEX)|TRUNCATE|DELETE FROM/i.test(code),
  "no data writes": !/^INSERT INTO/m.test(code) && !/^UPDATE /m.test(code),
  "all nine event types in the CHECK": EVENT_TYPES.every((t) => code.includes(`'${t}'`)),
  "constraint added once under its name":
    (code.match(new RegExp(`ADD CONSTRAINT ${NAME}\\b`, "g")) || []).length === 1,
  "quote-balanced outside the dash comments": (code.match(/'/g) || []).length % 2 === 0,
};

console.log(`\nWrote ${path}`);
console.log(`  dollar signs          : ${dollars} (expect 4)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");
process.exit(ok ? 0 : 1);
