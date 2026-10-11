-- ============================================================
-- PAUSE BILLING
--
-- An admin can suspend an account without cancelling it: billing stops, the
-- customer is locked out, and both are reversible in one click.
--
-- WHY LOCAL COLUMNS AND NOT STRIPE'S STATUS.
-- Stripe pauses via `pause_collection` on the subscription, which stops
-- invoicing but leaves `subscription.status` as 'active'. The 'paused' status
-- exists only for paused TRIALS. So Stripe cannot answer "is this account
-- paused" for a normal subscriber, and a webhook sync would overwrite any
-- guess we made. These columns are the source of truth; Stripe is told to stop
-- collecting as a side effect.
--
-- This also has to work with NO Stripe subscription at all — comped accounts,
-- trials, and accounts created by an admin. A pause must lock those out too,
-- which a Stripe-only mechanism could not do.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

ALTER TABLE subscriptions
  -- The gate. Checked by evaluateAccess ahead of comps and trials, so pausing
  -- a comped or trialing account actually locks it.
  ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE,

  -- When the pause began, for the admin log and the customer-facing page.
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,

  -- Which admin did it. No FK to profiles: an admin may later be deleted, and
  -- losing that row must not erase the fact the account was paused.
  ADD COLUMN IF NOT EXISTS paused_by UUID,

  -- Shown to the admin, never to the customer. "Non-payment" or "contract
  -- dispute" is not something to put in front of the person affected.
  ADD COLUMN IF NOT EXISTS pause_reason TEXT,

  /*
   * Optional auto-resume date, passed to Stripe as `pause_collection.resumes_at`.
   *
   * NULL means paused until an admin resumes it. Stored even when there is no
   * Stripe subscription so the intent survives a later Stripe connection.
   */
  ADD COLUMN IF NOT EXISTS pause_resumes_at TIMESTAMPTZ;

COMMENT ON COLUMN subscriptions.is_paused IS
  'Admin-applied suspension. Source of truth: Stripe keeps status=active while pause_collection is set, so its status cannot answer this.';

COMMENT ON COLUMN subscriptions.pause_reason IS
  'Internal note for admins. Never shown to the customer.';

-- Partial index: the only query that matters is "which accounts are paused",
-- and paused accounts are the rare case.
CREATE INDEX IF NOT EXISTS idx_subscriptions_paused
  ON subscriptions(is_paused) WHERE is_paused;
