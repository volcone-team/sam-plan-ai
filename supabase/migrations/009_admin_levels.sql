-- ============================================================
-- Admin hierarchy: super_admin vs admin
--
-- admin_level:
--   'super_admin' -> can promote/demote other admins + everything an admin can do
--   'admin'       -> manages customers (companies, users, roles) but NOT other admins
--   NULL          -> not an admin (regular customer)
--
-- is_admin stays as a fast boolean gate (true for both super_admin and admin).
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS admin_level TEXT
  CHECK (admin_level IN ('super_admin', 'admin') OR admin_level IS NULL);

-- Backfill: any existing admin becomes a regular 'admin' by default.
UPDATE profiles
SET admin_level = 'admin'
WHERE is_admin = TRUE AND admin_level IS NULL;

-- Helper: current user's admin level
CREATE OR REPLACE FUNCTION get_admin_level()
RETURNS TEXT AS $$
  SELECT admin_level FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: is the current user a super admin?
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(get_admin_level() = 'super_admin', FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- IMPORTANT: designate the first super admin manually after running this.
-- Replace the email below with your own account, then run:
--
--   UPDATE profiles
--   SET admin_level = 'super_admin', is_admin = TRUE
--   WHERE email = 'YOUR_ADMIN_EMAIL@example.com';
