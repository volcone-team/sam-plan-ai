-- ============================================================
-- 059: SUPPORT CONTACT DETAILS
--
-- The "Need Assistance?" footer on every portal page hardcoded the support
-- email and SMS number. Both are now edited on /admin/settings and stored on
-- the app_settings singleton.
--
-- Code does not depend on this being applied. Until it is, the footer shows
-- its old hardcoded values and the admin Save reports that the contact
-- details could not be stored.
--
-- SAFE TO RE-RUN.
-- ============================================================

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS support_email TEXT,
  ADD COLUMN IF NOT EXISTS support_phone TEXT;

COMMENT ON COLUMN app_settings.support_email IS
  'Support email shown in the portal footer. NULL = footer default.';
COMMENT ON COLUMN app_settings.support_phone IS
  'Public support phone (SMS) shown in the portal footer, as displayed. NULL = footer default.';
