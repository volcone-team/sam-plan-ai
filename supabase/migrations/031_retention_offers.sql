-- ============================================================
-- RETENTION OFFER REDEMPTIONS
--
-- The ledger that makes "One-time offer" true.
--
-- The cancellation flow's budget screen offers a discount to someone about to
-- leave. Without a record of who has taken one, the offer is repeatable: run
-- the flow, claim a free month, run it again next month, claim 50% off for two
-- more. Nothing in Stripe prevents that — a coupon with max_redemptions is
-- global, not per customer, and applying a discount to a subscription is an
-- ordinary update with no memory of previous ones.
--
-- ONE DISCOUNT PER COMPANY, EVER. The UNIQUE constraint is on company_id
-- alone, not (company_id, offer_id). Per-offer uniqueness would let a customer
-- collect every offer in the catalogue once each, which is the same leak with
-- extra steps. If a second discount is ever warranted that is a commercial
-- decision for an admin to make deliberately, not something the retention flow
-- should hand out on its own.
--
-- WHY A TABLE AND NOT A COLUMN ON `subscriptions`. The row survives the
-- subscription. A customer who takes a free month, cancels anyway, and later
-- resubscribes gets a NEW Stripe subscription — and a flag on the old one would
-- have gone with it, making the offer claimable again. Keyed on the company, it
-- does not.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

CREATE TABLE IF NOT EXISTS retention_offer_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  /*
   * One row per company, enforced here rather than checked in application
   * code. The check in the route is a courtesy that produces a readable
   * message; THIS is what holds under two concurrent requests, which is
   * exactly how someone would try to claim two offers at once.
   */
  company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,

  -- Which offer from the catalogue in src/lib/billing/cancellation.ts.
  -- No CHECK constraint, for the same reason as cancellation_feedback.reason:
  -- the catalogue is code, and a new offer should not need a migration.
  offer_id TEXT NOT NULL,

  -- The Stripe coupon actually applied, so a discount on an invoice can be
  -- traced back to the flow that granted it.
  coupon_id TEXT NOT NULL,
  stripe_subscription_id TEXT,

  -- Who claimed it. No FK to profiles: the person may later be deleted and
  -- that must not erase the fact that the company used its one offer.
  redeemed_by UUID,
  redeemed_by_email TEXT,

  /*
   * What the customer was told at the moment they accepted: the price they
   * were paying and when full billing resumes. Stored rather than recomputed
   * because the plan's price can change afterwards, and "what did we actually
   * promise this person" must stay answerable.
   */
  price_minor_at_redemption INT,
  billing_resumes_at TIMESTAMPTZ,

  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE retention_offer_redemptions IS
  'One retention discount per company, ever. The UNIQUE on company_id is the real enforcement of "one-time offer".';

COMMENT ON COLUMN retention_offer_redemptions.billing_resumes_at IS
  'What the customer was told at redemption, not a live value. The plan price can change afterwards; the promise cannot.';

-- "Which companies have used their offer, most recent first" — the admin view.
CREATE INDEX IF NOT EXISTS idx_retention_redemptions_redeemed
  ON retention_offer_redemptions(redeemed_at DESC);

-- ------------------------------------------------------------
-- RLS: service-role only, no readable policy.
--
-- Written solely by /api/billing/retention-offer with the service-role client.
-- A client that could read this would learn whether the discount is still
-- available before deciding to threaten to cancel; a client that could write it
-- could mark the offer as spent for someone else, or clear its own row and
-- claim again. Neither needs to be possible for the feature to work.
--
-- DROP-then-CREATE because Postgres has no CREATE POLICY IF NOT EXISTS, and a
-- guarded DO block would need dollar-quoting, which this project generates
-- rather than hand-writes.
-- ------------------------------------------------------------
ALTER TABLE retention_offer_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to retention redemptions" ON retention_offer_redemptions;
CREATE POLICY "No client access to retention redemptions"
  ON retention_offer_redemptions FOR SELECT USING (FALSE);
