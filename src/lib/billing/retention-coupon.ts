import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe-client";
import type { DiscountOfferSpec } from "@/lib/billing/cancellation";

/**
 * Get the Stripe coupon for a retention offer, creating it the first time.
 *
 * WHY ENSURE-ON-DEMAND RATHER THAN DASHBOARD SETUP. A coupon created by hand in
 * the Stripe dashboard is a deployment step nobody remembers, invisible to code
 * review, and silently different between a test and a live account — so the
 * offer would work in testing and fail for the first real customer who tried to
 * claim it, at the worst possible moment. Creating it from the spec in
 * DISCOUNT_OFFERS means the terms live in version control next to the copy that
 * describes them.
 *
 * IDEMPOTENT BY FIXED ID. The coupon id comes from the offer spec, so the first
 * claim creates it and every later claim retrieves the same one. Letting Stripe
 * generate ids would mint a new coupon per claim: hundreds of near-identical
 * coupons, and no way to tell at a glance what discounts are in circulation.
 *
 * TERMS ARE NEVER UPDATED. Stripe does not allow editing a coupon's discount
 * terms (only its name and metadata), and that restriction is a feature here:
 * changing "50% off" to "20% off" under an id customers are already on would
 * rewrite what they were promised. To change an offer, add a new spec with a
 * new id and leave the old coupon alone for the people already on it.
 */

/** Stripe caps a coupon's `name` at 40 characters and rejects anything longer. */
export const STRIPE_COUPON_NAME_MAX = 40;

/**
 * The dashboard name for a retention coupon.
 *
 * Kept short because Stripe rejects names over 40 characters, and a rejected
 * create means the customer's claim fails with a 502. The old prefix
 * ("SAM Plan AI retention — ") pushed "50% off for 2 months" to 44. The clamp
 * is a safety net for future titles; the name is cosmetic, so truncating it is
 * always better than failing the claim.
 */
export function retentionCouponName(offer: Pick<DiscountOfferSpec, "title">): string {
  return `SAM retention — ${offer.title}`.slice(0, STRIPE_COUPON_NAME_MAX).trimEnd();
}

/**
 * Stripe's "resource does not exist" shape, the only error that means "create
 * it". Any other failure (bad key, rate limit, malformed request) is rethrown
 * rather than treated as missing, so it is not masked by a doomed create.
 */
export function isMissingResource(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

export async function ensureRetentionCoupon(
  offer: DiscountOfferSpec
): Promise<Stripe.Coupon> {
  const stripe = getStripe();

  try {
    const existing = await stripe.coupons.retrieve(offer.couponId);
    /**
     * A coupon Stripe reports as deleted cannot be applied. Falling through to
     * create would fail on the duplicate id, so this is surfaced rather than
     * silently retried — it needs a human to pick a new id.
     */
    if (existing.deleted) {
      throw new Error(
        `Stripe coupon ${offer.couponId} is deleted and cannot be reused. ` +
        `Give the offer a new couponId in DISCOUNT_OFFERS.`
      );
    }
    // Returned as-is: the name (and every other field) is not compared, so
    // coupons created under the old, longer name keep working untouched.
    return existing;
  } catch (err) {
    if (!isMissingResource(err)) throw err;
  }

  /**
   * First claim. `duration_in_months` is sent ONLY for a repeating coupon:
   * Stripe rejects the parameter on a 'once' coupon, and rejects its absence on
   * a repeating one.
   *
   * Deliberately NO `max_redemptions`. Stripe's limit is global across all
   * customers, so a cap of any size would eventually start refusing legitimate
   * claims with no warning. "One per customer" is enforced by the UNIQUE on
   * retention_offer_redemptions.company_id, which is per-company and therefore
   * actually means what the screen says.
   */
  const created = await stripe.coupons.create({
    id: offer.couponId,
    name: retentionCouponName(offer),
    percent_off: offer.percentOff,
    duration: offer.duration,
    ...(offer.duration === "repeating" && offer.durationInMonths
      ? { duration_in_months: offer.durationInMonths }
      : {}),
    metadata: {
      source: "cancellation_flow",
      offer_id: offer.id,
      periods_covered: String(offer.periodsCovered),
    },
  });

  console.log("[retention-coupon] Created Stripe coupon", created.id);
  return created;
}

/**
 * Does this subscription already carry a discount?
 *
 * Checked because Stripe's `discounts` array on an update OVERWRITES rather
 * than appends. Applying a retention coupon to a subscription that already has
 * one would silently remove the existing discount — and if theirs was the
 * better deal, a button offering to save them money would have cost them.
 *
 * Reads the modern `discounts` array and falls back to the legacy singular
 * `discount` field, for the same reason subscriptionIdFromInvoice reads both
 * invoice shapes: a webhook endpoint pinned to an older API version still
 * delivers the old layout.
 */
export function hasExistingDiscount(sub: {
  discounts?: unknown;
  discount?: unknown;
}): boolean {
  if (Array.isArray(sub.discounts) && sub.discounts.length > 0) return true;
  if (sub.discount) return true;
  return false;
}
