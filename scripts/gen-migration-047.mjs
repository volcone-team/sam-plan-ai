/**
 * Generates migration 047 — the admin on/off switch for the new Initiative
 * Intake in the Add Initiative panel (app_settings.intake_v3_enabled).
 *
 * A GENERATOR, to match 028/029/035/037-046. The output contains no dollar
 * sign (checked on read-back). Guarded with IF NOT EXISTS, safe to re-run,
 * writes no data: the NOT NULL DEFAULT false fills the singleton row as OFF.
 *
 * Run: node scripts/gen-migration-047.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

const DOLLAR = String.fromCharCode(36);

const sql = `-- ============================================================
-- INTAKE V3 TOGGLE
--
-- One switch on the app_settings singleton (020). Off (the default): customers
-- see the current Add Initiative form. On: customers see the new picker and
-- form (045) for every record that is switched on and valid. Super admins
-- always see the new form, to preview it. Set at /admin/initiative-config.
--
-- Code reads a missing column as OFF (src/lib/intake-v3/rollout-setting.ts),
-- so the release does not depend on this being applied first.
-- ============================================================

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS intake_v3_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_settings.intake_v3_enabled IS
  'Whether customers get the new Initiative Intake in the Add Initiative panel. Default false (current form). Super admins always see the new form as a preview.';
`;

const path = "supabase/migrations/047_intake_v3_toggle.sql";
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
