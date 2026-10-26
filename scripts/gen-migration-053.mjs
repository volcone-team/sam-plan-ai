/**
 * Generates migration 053 — planning_inputs.customer_industries_other, the
 * free text revealed by "Other" on the intake's "What industries are your
 * customers in?" question.
 *
 * A GENERATOR, to match 028/029/035/037-052. The output contains no dollar
 * sign (checked on read-back). Guarded with IF NOT EXISTS, safe to re-run,
 * writes no data: the column is nullable with no default.
 *
 * Run: node scripts/gen-migration-053.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

const DOLLAR = String.fromCharCode(36);

const sql = `-- ============================================================
-- 053: CUSTOMER INDUSTRIES "OTHER" TEXT
--
-- planning_inputs.customer_industries (025) is a multi-select that includes
-- "Other". Picking it reveals a short optional text input ("Which
-- industry?"), stored here. Data only: the recommendations do not read it.
-- Cleared on save whenever "Other" is not among customer_industries
-- (src/lib/intake/draft.ts), capped at 200 characters in the form and on save.
--
-- Code does not depend on this being applied first: until it is, the draft
-- save is refused for the missing column and retried without it
-- (src/lib/intake/draft-columns.ts), so only this one answer is not kept.
--
-- Writes no data. Safe to re-run.
-- ============================================================

ALTER TABLE planning_inputs
  ADD COLUMN IF NOT EXISTS customer_industries_other TEXT;

COMMENT ON COLUMN planning_inputs.customer_industries_other IS
  'Intake v2 screen 7: free text revealed by Other in customer_industries ("Which industry?"). Optional, max 200 characters, NULL unless Other is selected. Stored for data only; not used by recommendations.';
`;

const path = "supabase/migrations/053_customer_industries_other.sql";
writeFileSync(path, sql, "utf8");

const written = readFileSync(path, "utf8");
const dollars = written.split(DOLLAR).length - 1;
const checks = {
  "file matches what was generated": written === sql,
  "adds the column with IF NOT EXISTS":
    /ADD COLUMN IF NOT EXISTS customer_industries_other TEXT;/.test(written),
  "comments the column": /COMMENT ON COLUMN planning_inputs\.customer_industries_other IS/.test(written),
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
