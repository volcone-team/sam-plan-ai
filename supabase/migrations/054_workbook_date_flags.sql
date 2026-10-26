-- ============================================================
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
