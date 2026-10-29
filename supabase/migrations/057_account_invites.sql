-- ============================================================
-- ACCOUNT INVITES THAT LAST 7 DAYS
--
-- Invites (admin "create company / user", Settings > Team) used to email a
-- Supabase token link directly. Supabase caps those at its Email OTP
-- expiry — one hour by default, 24 hours at most — so an invite opened the
-- next day was already dead.
--
-- Now the email carries OUR token, valid for 7 days. Opening it
-- (/auth/invite?token=...) checks this table and only then mints a fresh,
-- short-lived Supabase link and forwards to /auth/set-password. So the
-- Supabase link is always seconds old when used, and the invite itself lives
-- 7 days.
--
--   token_hash   SHA-256 of the emailed token; the token itself is never stored
--   expires_at   created_at + 7 days
--   revoked_at   set when a newer invite is sent to the same email (resend),
--                so only the latest link works
--   accepted_at  set once the person has chosen a password; the link then
--                sends them to sign in instead
--
-- RLS ON, NO POLICIES: read and written only by service-role server code.
-- Before this is applied the app falls back to the old direct links.
--
-- SAFE TO RE-RUN.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_invites_email ON account_invites (lower(email));

ALTER TABLE account_invites ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE account_invites IS
  'Our own 7-day invite tokens (hashed). /auth/invite exchanges a live one for a fresh Supabase set-password link. Service role only.';
