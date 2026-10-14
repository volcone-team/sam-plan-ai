-- ============================================================
-- CUSTOMER-INITIATED PAUSE
--
-- The cancellation flow's "take a break" screen lets a customer pause their own
-- billing. Migration 027 already built pausing, but built it as a PUNITIVE
-- ADMIN ACTION: pause_reason is an internal note never shown to the customer,
-- /account-paused tells them to contact their administrator, and nothing lets
-- them undo it. All of that is correct for a suspension and wrong for a break
-- somebody chose to take.
--
-- WHAT A PAUSE MEANS, decided deliberately: billing stops, ACCESS STOPS, and
-- nothing is deleted. Stopping billing while leaving full access would be
-- giving the product away, and the screen's own promises are about preservation
-- ("your plan and history stay saved", "everything waits for you exactly as you
-- left it"), not continued use. So this reuses the existing is_paused gate in
-- evaluateAccess rather than inventing a second kind of access.
--
-- WHY `pause_origin` AND NOT A BOOLEAN. Three states matter, and two of them
-- must never be confused: an admin suspension the customer may NOT lift, and a
-- self-imposed break they must be able to lift themselves. Overloading
-- pause_reason would have meant deciding that from free text an admin typed.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

ALTER TABLE subscriptions
  /*
   * Who paused this account: 'admin' or 'customer'. NULL when not paused.
   *
   * No CHECK constraint, matching the reasoning in 030: migration 029 had to
   * drop exactly this kind of CHECK off subscriptions.tier, and the writers are
   * two server routes whose values are fixed in code.
   */
  ADD COLUMN IF NOT EXISTS pause_origin TEXT,

  /*
   * When the "billing restarts soon" reminder went out.
   *
   * The pause screen promises "we'll email you a week before billing restarts".
   * A cron cannot keep that promise idempotently without somewhere to record
   * that it already has — a daily job would otherwise send the reminder every
   * day of the final week.
   */
  ADD COLUMN IF NOT EXISTS pause_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN subscriptions.pause_origin IS
  'admin | customer. Decides whether the customer may resume themselves. NULL when not paused.';

COMMENT ON COLUMN subscriptions.pause_reminder_sent_at IS
  'Idempotency marker for the pre-resume reminder email, not a display value.';

-- ------------------------------------------------------------
-- BACKFILL, AND IT MATTERS FOR SAFETY.
--
-- Every pause that exists today was applied by /api/admin/subscribers/pause,
-- because that was the only writer. Leaving pause_origin NULL on those rows
-- would make them indistinguishable from a customer pause the moment the
-- resume route starts reading this column — handing an admin-suspended account
-- (non-payment, contract dispute, abuse) the ability to un-suspend itself.
--
-- Scoped to currently-paused rows only. A row that is not paused has no origin
-- to record, and inventing one would be fabricating history.
-- ------------------------------------------------------------
UPDATE subscriptions
   SET pause_origin = 'admin'
 WHERE is_paused = TRUE
   AND pause_origin IS NULL;

/*
 * The cron's query: paused accounts with a resume date. Partial, because paused
 * accounts are the rare case and an unpaused row is never of interest to it.
 *
 * 027's index covers "which accounts are paused"; this one covers "which are
 * due to resume", which is a different question asked on a schedule.
 */
CREATE INDEX IF NOT EXISTS idx_subscriptions_pause_resumes
  ON subscriptions(pause_resumes_at)
  WHERE is_paused AND pause_resumes_at IS NOT NULL;
