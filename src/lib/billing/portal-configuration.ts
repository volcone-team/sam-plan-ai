import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe-client";

/**
 * The Stripe Billing Portal configuration we send customers to.
 *
 * WHY THIS EXISTS: the portal was offering CANCELLATION.
 *
 * `billingPortal.sessions.create` with no `configuration` uses the account's
 * default, and Stripe's default includes "Cancel subscription". That hands the
 * customer a one-click cancel which bypasses our entire retention flow — no
 * reason captured, no save offer shown, no `cancellation_feedback` row, and
 * nothing in the admin's "Reason for plan cancellation" note. The product has a
 * deliberate cancellation journey; a second, hidden door makes it optional.
 *
 * So the portal keeps the two things it is genuinely best at — updating a card
 * and reading invoice history — and cancellation is removed. Customers who
 * want to cancel use the flow in Settings, which is the supported path.
 *
 * CONFIGURED BY CODE, NOT IN THE DASHBOARD, matching the decision taken for
 * retention coupons. A dashboard setting is an unrecorded deploy step that
 * differs between the test and live keys and silently reverts the day somebody
 * clicks "reset to default".
 *
 * SUBSCRIPTION UPDATES ARE ALSO OFF. Plan changes have their own flow with
 * proration previews and entitlement checks (`/api/stripe/change-plan`); the
 * portal's version knows nothing about plan limits or retired plans.
 */

/** Marks the configuration as ours so it can be found again. */
const CONFIGURATION_MARKER = "sam_plan_portal_v1";

/**
 * Cached for the life of the server process.
 *
 * The configuration is immutable once created, so there is nothing to
 * revalidate. Without this, every visit to Settings costs a list call.
 */
let cachedConfigurationId: string | null = null;

/**
 * The id of our portal configuration, creating it on first use.
 *
 * THROWS rather than falling back to the default configuration. Falling back
 * would quietly restore the cancel button — the exact thing this function
 * exists to remove — so a portal that cannot be configured correctly must not
 * open at all.
 */
export async function ensurePortalConfiguration(): Promise<string> {
  if (cachedConfigurationId) return cachedConfigurationId;

  const stripe = getStripe();

  /**
   * Look for one we made earlier.
   *
   * Matched on metadata rather than on a remembered id, because the id is not
   * ours to choose — Stripe assigns it — and this process may be a cold start
   * long after the configuration was created.
   *
   * `active: true` because a configuration can be archived; an archived one
   * cannot be used for a session and must be recreated.
   */
  const existing = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });

  const ours = existing.data.find(
    (configuration) => configuration.metadata?.marker === CONFIGURATION_MARKER
  );

  if (ours) {
    cachedConfigurationId = ours.id;
    return ours.id;
  }

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    // What the portal is for.
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },

    /**
     * THE WHOLE POINT. Cancellation belongs to our flow, which captures the
     * reason and offers a save first.
     */
    subscription_cancel: { enabled: false },

    /**
     * Billing details only. `name` and `email` appear on invoices and
     * receipts, so letting a customer correct them is reasonable; anything
     * that changes what they are entitled to is not.
     */
    customer_update: {
      enabled: true,
      allowed_updates: ["email", "name", "address", "phone", "tax_id"],
    },
  };

  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Manage your SAM Plan AI billing",
    },
    features,
    metadata: {
      marker: CONFIGURATION_MARKER,
      /*
       * Recorded so the next person to read this in the Stripe dashboard knows
       * why cancellation is switched off and does not "fix" it.
       */
      note: "Cancellation is deliberately disabled — it runs through the in-app retention flow.",
    },
  });

  cachedConfigurationId = created.id;
  return created.id;
}

/** Test seam: forget the cached id so a test can exercise creation. */
export function resetPortalConfigurationCache(): void {
  cachedConfigurationId = null;
}
