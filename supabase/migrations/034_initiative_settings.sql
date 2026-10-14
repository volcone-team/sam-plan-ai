-- ============================================================
-- INITIATIVE SETTINGS — which library initiatives the AI may use
--
-- The workbook library is the AI's whole vocabulary: recommendations, the
-- intake picker, plan generation, Enhance and the chatbot all pick from
-- `wb_initiative_library`. There was no way to narrow that. The toggles on
-- /admin/initiatives act on `initiative_types`, a DIFFERENT 32-row list the AI
-- has never read, so they appeared to work and did nothing.
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON wb_initiative_library.
-- Every workbook upload DELETES and re-inserts those rows wholesale —
-- ingestWorkbook says so plainly: "These tables are DERIVED. Every upload
-- replaces them wholesale, so there is no merge logic and no drift." An
-- `is_active` column there would be silently wiped by the next upload, which
-- is the first thing anyone would do after setting the toggles.
--
-- Keyed on `initiative_key` rather than a row id for the same reason: the
-- library row the toggle refers to is destroyed and recreated on every upload,
-- but the key is stable, so a toggle re-attaches itself automatically.
--
-- THE LIBRARY STAYS COMPLETE. Nothing is removed from it — all 22 rows (and
-- whatever a future workbook adds) remain visible in the admin screen. This
-- table only decides what the AI is allowed to reference.
--
-- SAFE TO RE-RUN: every statement is guarded, and the seed never overwrites a
-- choice an admin has already made.
-- ============================================================

CREATE TABLE IF NOT EXISTS initiative_settings (
  /*
   * The workbook's own join key, e.g. 'webinar', 'dinners-lunches'. PRIMARY KEY
   * rather than a surrogate id: there is exactly one setting per initiative,
   * and keying on the natural key is what makes a toggle survive a re-upload.
   *
   * NO FOREIGN KEY to wb_initiative_library, deliberately. That table is
   * emptied during every ingest, so an FK would either block the delete or
   * cascade the settings away — the precise failure this table exists to
   * prevent. A settings row for an initiative that is not in the current
   * workbook is harmless: it simply has nothing to apply to until that
   * initiative reappears.
   */
  initiative_key TEXT PRIMARY KEY,

  /*
   * May the AI reference this initiative at all?
   *
   * FALSE is the meaningful default for this product right now: the owner wants
   * a small allowlist. But absent rows are treated as ACTIVE by the reader (see
   * loadLibrary), so a newly uploaded workbook never silently disables itself —
   * ingest inserts a row for every key it sees, making the default explicit and
   * visible in the admin screen rather than implied by absence.
   */
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  /*
   * Optional per-initiative ceiling on how many of this one may appear in a
   * single plan. NULL means "no specific limit", and the plan-wide cap of 5
   * still applies. Unused by the first release; added now because the
   * alternative is another hand-run migration for one nullable integer.
   */
  max_per_plan INT,

  /** Why it was switched off. Operator note, never shown to a customer. */
  notes TEXT,

  -- Who last changed it. No FK to profiles: an admin may later be deleted and
  -- losing that row must not erase the setting.
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE initiative_settings IS
  'Which wb_initiative_library initiatives the AI may reference. Separate from the library because every workbook upload replaces those rows wholesale.';

COMMENT ON COLUMN initiative_settings.is_active IS
  'FALSE hides the initiative from every AI surface. An ABSENT row reads as active, so a new workbook is never silently disabled.';

COMMENT ON COLUMN initiative_settings.max_per_plan IS
  'Reserved: per-initiative ceiling within one plan. NULL means only the plan-wide cap applies.';

-- The only hot query: "which keys may the AI use". Partial, because the active
-- set is the small side once an allowlist is in force.
CREATE INDEX IF NOT EXISTS idx_initiative_settings_active
  ON initiative_settings(initiative_key) WHERE is_active;

-- ------------------------------------------------------------
-- SEED — the owner's starting allowlist.
--
-- Six keys active: both webinars, Challenge/Bootcamp, VSL, Dinners and
-- Referral. Everything else currently in the library is switched off but stays
-- visible and one click from being re-enabled.
--
-- ON CONFLICT DO NOTHING on every statement, so re-running this migration can
-- never overwrite a decision an admin has made since. To change the allowlist,
-- use the admin screen — not this file.
-- ------------------------------------------------------------
INSERT INTO initiative_settings (initiative_key, is_active, notes)
VALUES
  ('webinar',             TRUE,  'Initial allowlist'),
  ('evergreen-webinars',  TRUE,  'Initial allowlist'),
  ('challenge-bootcamp',  TRUE,  'Initial allowlist'),
  ('vsl-sales-page',      TRUE,  'Initial allowlist'),
  ('dinners-lunches',     TRUE,  'Initial allowlist'),
  ('referral',            TRUE,  'Initial allowlist')
ON CONFLICT (initiative_key) DO NOTHING;

/*
 * Everything else present in the library today, explicitly OFF.
 *
 * Written out rather than derived with INSERT ... SELECT FROM
 * wb_initiative_library, because that table's contents depend on which
 * workbook happens to be uploaded when this migration runs. An explicit list
 * is reproducible; a derived one would differ between environments.
 *
 * A key absent from both lists — anything a future workbook introduces — is
 * inserted as ACTIVE by ingest, which is the safe direction: a new initiative
 * is visible and usable until someone decides otherwise.
 */
INSERT INTO initiative_settings (initiative_key, is_active, notes)
VALUES
  ('ops-in-person-other-peoples-stages', FALSE, 'Not in the initial allowlist'),
  ('hybrid-events',                      FALSE, 'Not in the initial allowlist'),
  ('networking-events',                  FALSE, 'Not in the initial allowlist'),
  ('podcast-vodcast-guest',              FALSE, 'Not in the initial allowlist'),
  ('social-media-lives',                 FALSE, 'Not in the initial allowlist'),
  ('online-workshops',                   FALSE, 'Not in the initial allowlist'),
  ('courses-memberships',                FALSE, 'Not in the initial allowlist'),
  ('your-own-event',                     FALSE, 'Not in the initial allowlist'),
  ('podcast-vodcast',                    FALSE, 'Not in the initial allowlist'),
  ('email-campaign',                     FALSE, 'Not in the initial allowlist'),
  ('paid-ads',                           FALSE, 'Not in the initial allowlist'),
  ('sales-calls',                        FALSE, 'Not in the initial allowlist'),
  ('content-organic-social',             FALSE, 'Not in the initial allowlist'),
  ('direct-message-reach-out',           FALSE, 'Not in the initial allowlist'),
  ('internal-launch',                    FALSE, 'Not in the initial allowlist'),
  ('affiliate-launches',                 FALSE, 'Not in the initial allowlist')
ON CONFLICT (initiative_key) DO NOTHING;

-- ------------------------------------------------------------
-- RLS: readable by signed-in users, writable only by the service role.
--
-- Read access is open because the intake picker and the recommendation screen
-- legitimately need to know which initiatives are on offer, and the answer is
-- not sensitive — it is the product's menu. Writes have no policy at all, so a
-- customer cannot switch an initiative on for themselves; the admin route uses
-- the service-role client, which bypasses RLS.
--
-- DROP-then-CREATE because Postgres has no CREATE POLICY IF NOT EXISTS and a
-- guarded DO block would need dollar-quoting, which this project generates
-- rather than hand-writes.
-- ------------------------------------------------------------
ALTER TABLE initiative_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read initiative settings" ON initiative_settings;
CREATE POLICY "Authenticated can read initiative settings"
  ON initiative_settings FOR SELECT USING (auth.uid() IS NOT NULL);
