import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CancelReason,
  OfferId,
  OfferOutcome,
} from "@/lib/billing/cancellation";

/**
 * The one place a `cancellation_feedback` row is written.
 *
 * Shared because two routes end the same journey: /api/billing/cancel when the
 * customer leaves or backs out, and /api/billing/retention-offer when a
 * discount saves them. Migration 030 promises one row per trip through the
 * flow, and two independently-written inserts would eventually disagree about
 * which columns to fill — most likely by one of them forgetting `offer_shown`,
 * which is what makes the funnel measurable.
 *
 * NEVER THROWS, the same contract as logActivity.
 *
 * This matters more here than it looks. By the time either caller reaches this
 * point the irreversible work is done — the subscription is cancelled in
 * Stripe, or a coupon has been applied to it. Failing the request because an
 * analytics insert did not land would tell the customer their action failed
 * when it succeeded, and invite them to do it again. Losing a feedback row is
 * the strictly cheaper failure, so it is the one we take.
 */

export type CancellationOutcome = "cancelled" | "kept" | "offer_accepted";

export interface CancellationFeedbackRow {
  companyId: string;
  userId: string | null;
  userEmail: string | null;
  reason: CancelReason;
  reasonDetail: string | null;
  outcome: CancellationOutcome;
  /** Which step-2 screen they saw, or null if they never reached one. */
  offerShown: OfferId | null;
  offerOutcome: OfferOutcome | null;
  /** Allow-listed payload from sanitiseOfferDetails. */
  details: Record<string, unknown>;
  planId: string | null;
  stripeSubscriptionId: string | null;
  accessEndsAt: string | null;
}

export async function recordCancellationFeedback(
  db: SupabaseClient,
  row: CancellationFeedbackRow
): Promise<void> {
  try {
    const { error } = await db.from("cancellation_feedback").insert({
      company_id: row.companyId,
      user_id: row.userId,
      user_email: row.userEmail,
      reason: row.reason,
      reason_detail: row.reasonDetail,
      outcome: row.outcome,
      offer_shown: row.offerShown,
      offer_outcome: row.offerOutcome,
      details: row.details,
      plan_id: row.planId,
      stripe_subscription_id: row.stripeSubscriptionId,
      access_ends_at: row.accessEndsAt,
    });

    if (error) {
      // Most likely cause early on: migration 030 not yet applied.
      console.error("[cancellation-record] Insert failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cancellation-record] Insert threw:", message);
  }
}
