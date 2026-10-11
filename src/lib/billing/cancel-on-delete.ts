import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe-client";

/**
 * Cancel a company's Stripe subscription when the account is deleted.
 *
 * WHY THIS IS NECESSARY. Deleting a company removes the local rows but Stripe
 * knows nothing about it, so the customer and their subscription survive and
 * KEEP BILLING. Three such orphans were found in this account — two still being
 * charged monthly with no account behind them.
 *
 * It also caused a second, subtler failure: `/api/billing/reconcile` recovers a
 * lost customer link by searching Stripe BY EMAIL, so registering a deleted
 * address again adopted the old subscription and silently granted that plan to
 * a brand-new account.
 *
 * CANCELLED IMMEDIATELY, not at period end. The account is gone; there is
 * nothing left to deliver for the remainder of the period, so continuing to
 * bill for it would be charging for nothing. No proration refund is issued —
 * that is a commercial decision, and refunding automatically on every admin
 * delete would be the wrong default.
 *
 * NEVER THROWS. Deletion must not fail because Stripe was unreachable: a
 * half-deleted account is worse than an orphaned subscription, and the result
 * is reported so the caller can log and surface it.
 */

export interface CancelResult {
  /** Subscription ids successfully cancelled. */
  cancelled: string[];
  /** Ids we tried and failed, with why. Needs manual cleanup in Stripe. */
  failed: { id: string; message: string }[];
  /** True when there was nothing to cancel. */
  nothingToDo: boolean;
}

export async function cancelSubscriptionsForCompany(
  db: SupabaseClient,
  companyId: string
): Promise<CancelResult> {
  const result: CancelResult = { cancelled: [], failed: [], nothingToDo: true };

  if (!isStripeConfigured()) {
    console.log("[cancel-on-delete] Stripe not configured — nothing to cancel.");
    return result;
  }

  try {
    const { data: rows } = await db
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_customer_id, stripe_status")
      .eq("company_id", companyId);

    const subs = (rows ?? []) as {
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
      stripe_status: string | null;
    }[];

    const stripe = getStripe();

    /**
     * Cancel by SUBSCRIPTION id where we have one, then sweep the CUSTOMER for
     * anything else live.
     *
     * The sweep matters: a customer can hold a subscription the local row never
     * recorded — a failed checkout write, or a second purchase — and leaving
     * that behind is exactly the orphan this function exists to prevent.
     */
    const seen = new Set<string>();

    for (const row of subs) {
      if (row.stripe_subscription_id) {
        seen.add(row.stripe_subscription_id);
      }
    }

    for (const row of subs) {
      if (!row.stripe_customer_id) continue;
      try {
        const live = await stripe.subscriptions.list({
          customer: row.stripe_customer_id,
          status: "all",
          limit: 20,
        });
        for (const s of live.data) {
          // Already-terminal subscriptions need no action.
          if (["canceled", "incomplete_expired"].includes(s.status)) continue;
          seen.add(s.id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[cancel-on-delete] Could not list subscriptions for customer",
          row.stripe_customer_id, "—", message
        );
      }
    }

    if (seen.size === 0) return result;
    result.nothingToDo = false;

    for (const subscriptionId of seen) {
      try {
        await stripe.subscriptions.cancel(subscriptionId);
        result.cancelled.push(subscriptionId);
        console.log("[cancel-on-delete] Cancelled", subscriptionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A subscription already cancelled in Stripe is not a failure.
        if (/No such subscription|already canceled/i.test(message)) {
          result.cancelled.push(subscriptionId);
          continue;
        }
        result.failed.push({ id: subscriptionId, message });
        console.error("[cancel-on-delete] FAILED to cancel", subscriptionId, "—", message);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cancel-on-delete] Unexpected failure:", message);
  }

  return result;
}
