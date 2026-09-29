-- ============================================================
-- Two-factor codes (app-owned)
--
-- Replaces the previous approach, which borrowed Supabase's login OTP:
-- `auth.admin.generateLink({ type: 'magiclink' })` was called purely to steal
-- `properties.email_otp` off the response. That had two defects:
--
--   1. Supabase keeps ONE active email OTP per user. Every send invalidated the
--      previous one, so two environments pointed at this same project (local +
--      Vercel) silently killed each other's codes. The second environment to
--      request a code broke the first, which surfaced to users as
--      "That code is incorrect or has expired."
--   2. A magiclink OTP can be redeemed against Supabase for a FULL SESSION.
--      The emailed "second factor" was therefore interchangeable with a
--      complete login, which inverts what the factor is supposed to prove.
--
-- Codes now live here instead, so nothing outside this app can invalidate them.
--
-- DESIGN NOTE — multiple codes are valid at once, ON PURPOSE.
-- Sending does NOT delete or invalidate earlier rows. Deleting on send would
-- reproduce defect (1) above with the table merely moved in-house: a local
-- login would wipe the code a live login is mid-way through typing. Verify
-- accepts ANY unconsumed, unexpired code for the user, so concurrent logins
-- across environments, browsers and devices each hold an independent code and
-- none can break another. Codes are single-use (`consumed_at`) and short-lived.
--
-- Service-role writes AND reads only. See the RLS note at the bottom: this
-- table deliberately has NO policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS two_factor_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- HMAC-SHA256 of the 8 digits, peppered with TWO_FACTOR_SECRET. Never the
  -- code itself: a plaintext column is a readable credential to anyone with
  -- table access. A PLAIN hash would not be enough either — 8 digits is only
  -- 10^8 candidates, so an unsalted SHA-256 is exhaustible offline in seconds.
  -- The server-side pepper is what makes a leaked hash useless.
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  -- Per-code failed-attempt counter. Eight digits is not brute-forceable in a
  -- hurry, but without a cap there is nothing stopping someone grinding a code
  -- for its whole validity window.
  attempts    INT NOT NULL DEFAULT 0,
  -- Stamped rather than deleted on success, so a replayed code is
  -- distinguishable from one that never existed.
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verify reads the newest rows for one user; send counts recent rows to throttle.
CREATE INDEX IF NOT EXISTS idx_2fa_codes_user_created
  ON two_factor_codes(user_id, created_at DESC);

-- Supports the opportunistic cleanup of long-dead rows in the verify route.
CREATE INDEX IF NOT EXISTS idx_2fa_codes_expires
  ON two_factor_codes(expires_at);

-- ------------------------------------------------------------
-- RLS: enabled with NO policies, deliberately.
--
-- Unlike the other tables in this schema, there is no "users can read their
-- own rows" policy here and there must not be. Handing a user their own
-- `code_hash` would let them brute-force it offline at their leisure, which
-- defeats the pepper. Both routes use the service-role client, which bypasses
-- RLS, so enabling it with zero policies denies everyone else by default.
-- ------------------------------------------------------------
ALTER TABLE two_factor_codes ENABLE ROW LEVEL SECURITY;
