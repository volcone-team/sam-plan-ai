import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getStripe,
  isStripeConfigured,
  loadBillingConfig,
  STRIPE_MODE_TAG,
} from "@/lib/billing/stripe-client";
import {
  canCancel,
  canOfferDiscount,
  discountOffer,
  isCancelReason,
  isDiscountOfferId,
  billingResumesOn,
  offersForCycle,
  formatAccessDate,
  offerFor,
  sanitiseOfferDetails,
} from "@/lib/billing/cancellation";
import {
  ensureRetentionCoupon,
  hasExistingDiscount,
} from "@/lib/billing/retention-coupon";
import { recordCancellationFeedback } from "@/lib/billing/cancellation-record";
import { logActivity } from "@/lib/activity-log";
import { sendRetentionOfferEmail } from "@/lib/mailgun";
import { getAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST /api/billing/retention-offer
 *
 * Applies a discount to the caller's subscription instead of cancelling it —
 * the "Claim my free month" button on the budget screen.
 *
 * SEPARATE FROM /api/billing/cancel ON PURPOSE. It would have been convenient
 * to add an `outcome: "offer_accepted"` branch there, but the two do opposite
 * things to the subscription and have opposite failure modes. A bug in the
 * cancel path stops money; a bug here GIVES money away, repeatedly if the
 * one-per-company rule leaks. Keeping it in its own route keeps the guards in
 * one readable place rather than behind a conditional in a longer handler.
 *
 * THE ORDER OF WRITES IS THE SAFETY PROPERTY:
 *
 *   1. Claim the redemption row FIRST, before Stripe. The UNIQUE on company_id
 *      is what makes "one-time offer" true, so claiming it up front means two
 *      concurrent requests cannot both reach the discount — the loser gets a
 *      duplicate-key error and is turned away. Doing it the other way round
 *      (Stripe, then record) leaves a window in which both requests apply a
 *      coupon and only one row lands.
 *   2. Apply the coupon in Stripe.
 *   3. If Stripe fails, RELEASE the claim, so a network blip does not burn the
 *      customer's one offer on nothing.
 *
 * Body: { reason: CancelReason, reasonDetail?: string, offerId: DiscountOfferId,
 *         offerDetails?: object }
 *
 * Responses:
 *   200 { accepted: true, offerId, billingResumesAt, summary }
 *   400 { error: "invalid_reason" | "invalid_offer" }
 *   401 { error: "Unauthorized" }
 *   403 { error: "billing_disabled" | "not_permitted" }
 *   409 { error: "offer_unavailable", blocker }
 *   502 { error: "stripe_failed", message }
 *   503 { error: "stripe_not_configured" | "redemptions_unavailable" }
 */

const MAX_DETAIL_CHARS = 2000;

interface SubRow {
  id: string;
  plan_id: string | null;
  status: string;
  stripe_status: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  stripe_mode: string | null;
  billing_cycle: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  is_comped: boolean;
  is_paused: boolean | null;
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Postgres unique-violation, i.e. this company already used its offer. */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: {
      reason?: unknown; reasonDetail?: unknown;
      offerId?: unknown; offerDetails?: unknown;
    } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }

    if (!isCancelReason(body.reason)) {
      return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
    }
    if (!isDiscountOfferId(body.offerId)) {
      return NextResponse.json({ error: "invalid_offer" }, { status: 400 });
    }

    const reason = body.reason;
    const offer = discountOffer(body.offerId)!;
    const reasonDetail =
      typeof body.reasonDetail === "string" && body.reasonDetail.trim()
        ? body.reasonDetail.trim().slice(0, MAX_DETAIL_CHARS)
        : null;

    const db = serviceClient();

    const config = await loadBillingConfig(db);
    if (!config.stripeEnabled) {
      return NextResponse.json({ error: "billing_disabled" }, { status: 403 });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role, email, first_name")
      .eq("id", user.id)
      .maybeSingle();

    const me = profile as {
      company_id: string | null; role: string | null;
      email: string | null; first_name: string | null;
    } | null;

    // Owner-only, matching cancel and the portal.
    if (!me?.company_id || (me.role && me.role !== "owner")) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    const companyId = me.company_id;

    const { data: subRaw } = await db
      .from("subscriptions")
      .select(
        "id, plan_id, status, stripe_status, stripe_subscription_id, stripe_price_id, " +
        "stripe_mode, billing_cycle, current_period_end, cancel_at_period_end, " +
        "is_comped, is_paused"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const sub = subRaw as SubRow | null;
    const resolvedStatus = sub ? (sub.stripe_status ?? sub.status) : null;
    const hasStripeSubscription =
      !!sub?.stripe_subscription_id && sub.stripe_mode === STRIPE_MODE_TAG;

    /**
     * The discount is only meaningful for someone who could actually cancel.
     * Reusing canCancel means a comped, paused, trialing or already-ending
     * account is refused here for the same reasons and in the same order as on
     * the cancel route, rather than by a second set of rules that could drift.
     */
    const cancelEligibility = canCancel(
      sub
        ? {
            status: resolvedStatus,
            isComped: sub.is_comped,
            isPaused: sub.is_paused ?? false,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            hasStripeSubscription,
            currentPeriodEnd: sub.current_period_end,
          }
        : null
    );

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    const stripe = getStripe();

    /**
     * Read the live subscription before deciding. Our row does not record
     * discounts at all, so the only way to know whether applying one would
     * clobber an existing promotion is to ask Stripe.
     */
    let stripeSub = null;
    if (cancelEligibility.allowed && sub?.stripe_subscription_id) {
      try {
        stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      } catch (err) {
        console.error("[billing/retention-offer] Could not read subscription:", errMessage(err));
        return NextResponse.json(
          { error: "stripe_failed", message: errMessage(err) },
          { status: 502 }
        );
      }
    }

    // What they pay now, for the footnote and for the record of what we promised.
    const { data: priceRow } = sub?.stripe_price_id
      ? await db
          .from("stripe_prices")
          .select("unit_amount, currency")
          .eq("stripe_mode", STRIPE_MODE_TAG)
          .eq("stripe_price_id", sub.stripe_price_id)
          .maybeSingle()
      : { data: null };

    const price = priceRow as { unit_amount: number; currency: string } | null;

    /**
     * Has this company already used its one offer?
     *
     * A read failure is treated as "unavailable" rather than "not redeemed".
     * Failing open here would hand out a second discount every time the
     * database hiccuped, which is the one direction this check must never fail.
     */
    const { data: existingRedemption, error: redemptionError } = await db
      .from("retention_offer_redemptions")
      .select("id, offer_id")
      .eq("company_id", companyId)
      .maybeSingle();

    if (redemptionError) {
      console.error(
        "[billing/retention-offer] Could not read redemptions:",
        redemptionError.message
      );
      return NextResponse.json({ error: "redemptions_unavailable" }, { status: 503 });
    }

    const eligibility = canOfferDiscount({
      cancelEligible: cancelEligibility.allowed,
      billingCycle: sub?.billing_cycle ?? null,
      hasExistingDiscount: stripeSub ? hasExistingDiscount(stripeSub) : false,
      alreadyRedeemed: !!existingRedemption,
      priceMinor: price?.unit_amount ?? null,
      /**
       * THE OFFER IS PASSED IN HERE, and that is the point.
       *
       * The client chooses which offer to claim, so the cycle test has to be
       * against the CHOSEN offer rather than "does this cycle have any offer".
       * Without it an annual subscriber could post `free_month` and receive a
       * 100%-off coupon against an annual invoice — a free year. The screen
       * only ever shows them the annual offer, but the screen is not what
       * decides; this is.
       */
      offer,
    });

    if (!eligibility.allowed) {
      /**
       * LOGGED, because the customer-facing message cannot say this.
       *
       * The UI deliberately collapses the cycle, price and cancel-eligibility
       * blockers into one vague sentence — it must not coach a customer into
       * changing their billing cycle to unlock a better discount. That makes
       * the refusal undiagnosable from the outside, so the real
       * reason goes here instead. scripts/inspect-retention-eligibility.mjs
       * answers the same question across every account.
       */
      console.warn(
        "[billing/retention-offer] Refused for company", companyId,
        "| blocker:", eligibility.blocker,
        "| requested offer:", offer.id,
        "| offers valid for this cycle:",
        offersForCycle(sub?.billing_cycle ?? null).map((o) => o.id).join(",") || "none",
        "| cycle:", sub?.billing_cycle ?? "none",
        "| cancelEligible:", cancelEligibility.allowed,
        cancelEligibility.allowed ? "" : `(${(cancelEligibility as { blocker: string }).blocker})`,
        "| alreadyRedeemed:", !!existingRedemption,
        "| priceMinor:", price?.unit_amount ?? "unknown"
      );
      return NextResponse.json(
        { error: "offer_unavailable", blocker: eligibility.blocker },
        { status: 409 }
      );
    }

    const subscriptionId = sub!.stripe_subscription_id!;
    const resumesAt = billingResumesOn(sub!.current_period_end, offer.periodsCovered);

    /**
     * CLAIM FIRST. The insert is the concurrency guard: with UNIQUE on
     * company_id, two simultaneous requests cannot both get past this line, so
     * only one can go on to apply a coupon.
     */
    const { error: claimError } = await db
      .from("retention_offer_redemptions")
      .insert({
        company_id: companyId,
        offer_id: offer.id,
        coupon_id: offer.couponId,
        stripe_subscription_id: subscriptionId,
        redeemed_by: user.id,
        redeemed_by_email: me.email,
        price_minor_at_redemption: price?.unit_amount ?? null,
        billing_resumes_at: resumesAt,
      });

    if (claimError) {
      if (isUniqueViolation(claimError)) {
        // Lost a race, or the read above was stale. Either way: already used.
        return NextResponse.json(
          { error: "offer_unavailable", blocker: "already_redeemed" },
          { status: 409 }
        );
      }
      // Cannot record it, so do not grant it: an ungranted offer is recoverable,
      // an unrecorded discount is a permanent hole in the one-time rule.
      console.error("[billing/retention-offer] Claim failed:", claimError.message);
      return NextResponse.json({ error: "redemptions_unavailable" }, { status: 503 });
    }

    /** Undo the claim, so a Stripe failure does not burn their one offer. */
    const releaseClaim = async () => {
      const { error } = await db
        .from("retention_offer_redemptions")
        .delete()
        .eq("company_id", companyId);
      if (error) {
        // Logged loudly: the customer now cannot claim an offer they never got.
        console.error(
          "[billing/retention-offer] COULD NOT RELEASE CLAIM for company",
          companyId, "—", error.message
        );
      }
    };

    try {
      await ensureRetentionCoupon(offer);
    } catch (err) {
      await releaseClaim();
      console.error("[billing/retention-offer] Coupon setup failed:", errMessage(err));
      return NextResponse.json(
        { error: "stripe_failed", message: errMessage(err) },
        { status: 502 }
      );
    }

    try {
      /**
       * `discounts` replaces the whole set, which is safe only because
       * hasExistingDiscount already established there is nothing to replace.
       */
      await stripe.subscriptions.update(subscriptionId, {
        discounts: [{ coupon: offer.couponId }],
      });
    } catch (err) {
      await releaseClaim();
      console.error("[billing/retention-offer] Could not apply discount:", errMessage(err));
      return NextResponse.json(
        { error: "stripe_failed", message: errMessage(err) },
        { status: 502 }
      );
    }

    /**
     * The journey is recorded as offer_accepted, with the offer screen marked
     * as having worked. Best effort from here on — the discount is applied, and
     * no bookkeeping failure should tell the customer otherwise.
     */
    await recordCancellationFeedback(db, {
      companyId,
      userId: user.id,
      userEmail: me.email,
      reason,
      reasonDetail,
      outcome: "offer_accepted",
      // Derived, not trusted: the budget screen is the only one that can reach
      // this route, and offerFor confirms it is actually built.
      offerShown: offerFor(reason),
      offerOutcome: "accepted",
      details: {
        ...sanitiseOfferDetails(offerFor(reason), body.offerDetails),
        acceptedOffer: offer.id,
        couponId: offer.couponId,
      },
      planId: sub!.plan_id,
      stripeSubscriptionId: subscriptionId,
      accessEndsAt: sub!.current_period_end,
    });

    // From the spec, so the route, the success screen and the email cannot
    // describe the same discount three different ways.
    const summary = offer.acceptedSummary;

    const symbol = (price?.currency ?? "usd").toUpperCase() === "USD" ? "$" : "";
    const normalPrice =
      typeof price?.unit_amount === "number"
        ? `${symbol}${(price.unit_amount / 100).toFixed(
            price.unit_amount % 100 === 0 ? 0 : 2
          )}`
        : null;

    if (me.email) {
      const { data: plan } = sub!.plan_id
        ? await db
            .from("subscription_plans")
            .select("name")
            .eq("id", sub!.plan_id)
            .maybeSingle()
        : { data: null };

      const sent = await sendRetentionOfferEmail(me.email, {
        firstName: me.first_name,
        planName: (plan as { name?: string } | null)?.name ?? null,
        offerTitle: offer.title,
        offerSummary: summary,
        billingResumesOn: formatAccessDate(resumesAt),
        normalPrice,
        settingsUrl: `${getAppUrl()}/settings`,
      });
      if (!sent) {
        console.error("[billing/retention-offer] Confirmation email not sent to", me.email);
      }
    }

    await logActivity({
      companyId,
      actorUserId: user.id,
      actorEmail: me.email,
      action: "billing.retention_offer_accepted",
      targetType: "subscription",
      targetId: sub!.id,
      metadata: {
        reason,
        offerId: offer.id,
        couponId: offer.couponId,
        percentOff: offer.percentOff,
        periodsCovered: offer.periodsCovered,
        priceMinorAtRedemption: price?.unit_amount ?? null,
        billingResumesAt: resumesAt,
      },
    });

    console.log(
      "[billing/retention-offer] company", companyId,
      "| offer:", offer.id,
      "| billing resumes:", resumesAt ?? "unknown"
    );

    return NextResponse.json({
      accepted: true,
      offerId: offer.id,
      billingResumesAt: resumesAt,
      summary,
    });
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[billing/retention-offer] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
