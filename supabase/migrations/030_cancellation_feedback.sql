-- ============================================================
-- CANCELLATION FEEDBACK
--
-- One row per trip through the cancellation flow, recorded whichever way it
-- ends: cancelled, kept, or a save-offer accepted. The point is to know WHY
-- people leave and which offers actually work, which is unanswerable today —
-- cancellation currently happens on Stripe's hosted portal and we learn
-- nothing beyond the fact of it.
--
-- WHY A ROW FOR PEOPLE WHO STAY. An offer that nobody accepts and an offer
-- nobody is ever shown look identical if only cancellations are logged. The
-- `outcome` column is what makes the funnel measurable.
--
-- WHY NOT ONLY STRIPE'S `cancellation_details`. The route sends the reason to
-- Stripe too (it has a native `feedback` enum, so churn shows up in the Stripe
-- dashboard for free), but Stripe stores one enum value and one comment, keeps
-- nothing for a customer who stays, and is not joinable to our own tables.
-- Both are written; this is the one we can query.
--
-- NO CHECK CONSTRAINT ON `reason`. The reason catalogue lives in
-- src/lib/billing/cancellation.ts and the route validates against it. A CHECK
-- here would mean a migration every time the client reworks the wording of an
-- option — and migration 029 already had to drop exactly this kind of CHECK off
-- `subscriptions.tier` for exactly that reason.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

CREATE TABLE IF NOT EXISTS cancellation_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Cascades: churn feedback about a deleted company is not worth the orphan.
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  /*
   * Who went through the flow. No FK to profiles deliberately, matching
   * subscriptions.paused_by: the person may later be deleted, and losing that
   * row must not erase the fact that they told us why they left.
   */
  user_id UUID,
  user_email TEXT,

  -- Reason code from the catalogue in src/lib/billing/cancellation.ts.
  reason TEXT NOT NULL,

  -- The "Anything else?" free text. Truncated by the route, not the column, so
  -- an over-long answer is shortened rather than rejected.
  reason_detail TEXT,

  /*
   * How it ended.
   *   cancelled      -> subscription set to stop at period end
   *   kept           -> backed out ("Keep my plan") at any step
   *   offer_accepted -> took a save-offer (phase 3+)
   */
  outcome TEXT NOT NULL,

  -- Which step-2 save-offer was presented, and what they did with it.
  -- Both NULL in phase 1, where no offers are shown yet.
  offer_shown TEXT,
  offer_outcome TEXT,

  /*
   * Per-branch extras, so later phases need no migration: 2e's "what's
   * missing" and "which tool", 2d's pause length, 2a's chosen discount.
   * JSONB rather than columns because each branch collects a different shape
   * and most rows would be mostly NULL.
   */
  details JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- What they were on when they left. SET NULL rather than cascade: a retired
  -- and later deleted plan must not delete the churn record that explains it.
  plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,

  -- Captured at the time so the record stays true after the row moves on.
  stripe_subscription_id TEXT,
  access_ends_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cancellation_feedback IS
  'One row per pass through the cancellation flow, including the ones who stayed. Operator data: contains customer free text.';

COMMENT ON COLUMN cancellation_feedback.outcome IS
  'cancelled | kept | offer_accepted. Rows for customers who stayed are what make the retention funnel measurable.';

COMMENT ON COLUMN cancellation_feedback.reason IS
  'Code from the catalogue in src/lib/billing/cancellation.ts. Intentionally unconstrained here — see the migration header.';

-- "Has this company been here before, and what happened last time" is the only
-- per-company query, and it always wants the most recent first.
CREATE INDEX IF NOT EXISTS idx_cancellation_feedback_company
  ON cancellation_feedback(company_id, created_at DESC);

-- "Why are people leaving this month" — the admin churn view.
CREATE INDEX IF NOT EXISTS idx_cancellation_feedback_created
  ON cancellation_feedback(created_at DESC);

-- ------------------------------------------------------------
-- RLS: service-role only, NO policies.
--
-- Written exclusively by /api/billing/cancel using the service-role client.
-- There is deliberately no read policy: `reason_detail` is a customer's
-- unfiltered complaint about the product, which is operator data in the same
-- way stripe_webhook_events is. Enabling RLS with no policy denies every
-- anon/authenticated path while leaving the service role unaffected.
--
-- DROP-then-CREATE rather than a guarded DO block: Postgres has no
-- CREATE POLICY IF NOT EXISTS, and a DO block would need dollar-quoting, which
-- this project generates rather than hand-writes. This form is idempotent and
-- needs neither.
-- ------------------------------------------------------------
ALTER TABLE cancellation_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to cancellation feedback" ON cancellation_feedback;
CREATE POLICY "No client access to cancellation feedback"
  ON cancellation_feedback FOR SELECT USING (FALSE);
