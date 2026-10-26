/**
 * Generates migration 054 — two raw workbook columns on wb_initiative_library
 * holding the "Start Date" and "Event Date" Yes / No cells.
 *
 * A GENERATOR, to match 028/029/035/037-053. This migration needs no DO
 * block, so it contains no dollar quotes at all; the check below insists on
 * that (String.fromCharCode(36) is the dollar sign, so no shell or JS
 * replace() can have slipped one in), and the file is read back to check.
 *
 * Re-runnable: both columns use IF NOT EXISTS. Writes no data. Nullable, no
 * default, so every existing row and every pre-054 reader is unaffected.
 *
 * Run: node scripts/gen-migration-054.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";
const DOLLAR = String.fromCharCode(36);
const COLUMNS = ["start_date_raw", "event_date_raw"];
const sql = `-- ============================================================
-- 054: RAW WORKBOOK "Start Date" / "Event Date" CELLS
--
-- wb_initiative_library gains two nullable TEXT columns holding the raw
-- "Start Date" and "Event Date" cells of the workbook's "1. Initiative
-- Library" sheet, unparsed ("Yes" / "No"). They say whether the New
-- Initiative form asks for that date. Parsed by parseWorkbookYesNo
-- (src/lib/intake-v3/workbook-kinds.ts) when deriveConfig builds a record's
-- config; there is deliberately NO initiative_library_config column: the
-- workbook is the only source.
--
-- Code does not depend on this being applied: the workbook upload retries
-- the insert without these columns (src/lib/workbook/ingest.ts,
-- nextLibraryColumnSet), and the config reader re-selects without them
-- (src/lib/intake-v3/config-repo.ts). Until it is applied every record asks
-- for both dates, as before. Re-upload the workbook after applying it.
--
-- Writes no data. Safe to re-run.
-- ============================================================
ALTER TABLE wb_initiative_library
  ADD COLUMN IF NOT EXISTS start_date_raw TEXT;
ALTER TABLE wb_initiative_library
  ADD COLUMN IF NOT EXISTS event_date_raw TEXT;
COMMENT ON COLUMN wb_initiative_library.start_date_raw IS
  'The workbook''s raw "Start Date" cell for this initiative (Yes / No), unparsed: whether the New Initiative form asks for a start date. NULL when the column or cell is blank, which means ask. Read by the workbook-to-config derivation.';
COMMENT ON COLUMN wb_initiative_library.event_date_raw IS
  'The workbook''s raw "Event Date" cell for this initiative (Yes / No), unparsed: whether the New Initiative form asks for an event date. NULL when the column or cell is blank, which means ask. Read by the workbook-to-config derivation.';
`;
const path = "supabase/migrations/054_workbook_date_flags.sql";
writeFileSync(path, sql, "utf8");
const written = readFileSync(path, "utf8");
const dollars = written.split(DOLLAR).length - 1;
const code = written
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const checks = {
  "file matches what was generated": written === sql,
  "no dollar signs (no DO block needed)": dollars === 0,
  "no functions created": !/CREATE (OR REPLACE )?FUNCTION/i.test(written),
  "no table/column/index/constraint drops or data deletes":
    !/DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|TRUNCATE|DELETE FROM/i.test(code),
  "no data writes": !/^INSERT INTO/m.test(code) && !/^UPDATE /m.test(code),
  "both columns added once, IF NOT EXISTS, as TEXT": COLUMNS.every(
    (c) => (code.match(new RegExp(`ADD COLUMN IF NOT EXISTS ${c} TEXT;`, "g")) || []).length === 1
  ),
  "both columns commented": COLUMNS.every(
    (c) => (code.match(new RegExp(`COMMENT ON COLUMN wb_initiative_library\\.${c} IS`, "g")) || []).length === 1
  ),
  "quote-balanced outside the dash comments": (code.match(/'/g) || []).length % 2 === 0,
};
console.log(`\nWrote ${path}`);
console.log(`  dollar signs          : ${dollars} (expect 0)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");
process.exit(ok ? 0 : 1);
