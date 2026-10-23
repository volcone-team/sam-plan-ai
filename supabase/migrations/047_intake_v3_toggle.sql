-- ============================================================
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
