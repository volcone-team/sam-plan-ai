import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadBillingConfig, STRIPE_MODE_TAG, getStripe } from "@/lib/billing/stripe-client";
import {
  describeActiveDiscount,
  couponIdFromDiscount,
  type ActiveDiscount,
} from "@/lib/billing/discount-display";
import { evaluateAccess } from "@/lib/billing/entitlement";
import { hasLiveStripeSubscription } from "@/lib/billing/live-subscription";
import { resolveUsagePeriod, checkLimit } from "@/lib/billing/limits";
import { canCancel, canOfferDiscount } from "@/lib/billing/cancellation";
import { canPauseSelf } from "@/lib/billing/pause";
import { resolveBookingUrls } from "@/lib/billing/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/me
 *
 * Everything the customer-facing billing UI needs: available plans, the caller's
 * current subscription, their access state, and this period's usage against each
 * of their plan's limits.
 *
 * Usage is computed with the SAME functions the server enforces with, so the
 * numbers a customer sees cannot disagree with the answer they get when they
 * press Generate.
 *
 * Returns { billingEnabled: false } when Stripe is off — the UI then hides
 * pricing entirely rather than showing plans nobody can buy.
 */
export async function GET() {
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

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const config = await loadBillingConfig(db);

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = profile?.company_id ?? null;

    /**
     * EVERY plan, active or not.
     *
     * This used to filter on `is_active`, which broke the one case that matters
     * when a plan is retired: a subscriber on it could no longer be NAMED. The
     * lookup below (`plans.find(p => p.id === sub.plan_id)`) returned undefined
     * and fell back to `sub.tier` — a legacy pre-Stripe string — so a customer
     * paying for Pro was told they were on Starter.
     *
     * Retiring a plan means "stop offering it to new customers", not "take it
     * away from existing ones". Their limits and their Stripe billing are both
     * unchanged, so the label has to match that.
     *
     * The active filter now applies only to the PURCHASABLE list below.
     */
    const { data: plansRaw } = await db
      .from("subscription_plans")
      .select(
        "id, name, description, tagline, monthly_price, annual_price, " +
        "is_default, is_active, display_order"
      )
      .order("display_order");

    // Via `unknown`: supabase-js cannot infer a row shape from a concatenated
    // select string and falls back to a union including an error type.
    const allPlans = (plansRaw ?? []) as unknown as {
      id: string; name: string; description: string | null; tagline: string | null;
      monthly_price: number; annual_price: number; is_default: boolean;
      is_active: boolean;
    }[];

    /** Offered to new buyers. A retired plan is not on the pricing cards. */
    const plans = allPlans.filter((p) => p.is_active);

    // Which plans can actually be bought right now: a plan with no synced price
    // for the active mode cannot go through checkout, so the UI must not offer it.
    const { data: prices } = await db
      .from("stripe_prices")
      // unit_amount and currency are selected so the cancellation flow can say
      // what the standard rate for a plan IS, which it needs in order to tell a
      // grandfathered subscriber what they would pay on coming back.
      .select("plan_id, billing_cycle, unit_amount, currency")
      .eq("stripe_mode", STRIPE_MODE_TAG)
      .eq("is_current", true);

    const currentPrices = (prices ?? []) as {
      plan_id: string; billing_cycle: string; unit_amount: number; currency: string;
    }[];

    const purchasable = new Set(
      currentPrices.map((p) => `${p.plan_id}:${p.billing_cycle}`)
    );

    // Plan limits and features for display on the pricing cards.
    const planIds = plans.map((p) => p.id);
    const [{ data: limitRows }, { data: featureRows }] = await Promise.all([
      planIds.length
        ? db.from("plan_limits").select("plan_id, limit_key, limit_label, limit_value").in("plan_id", planIds)
        : Promise.resolve({ data: [], error: null }),
      planIds.length
        ? db.from("plan_features").select("plan_id, feature_key, feature_label, enabled").in("plan_id", planIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const limitsByPlan = new Map<string, { key: string; label: string; value: number }[]>();
    for (const r of (limitRows ?? []) as {
      plan_id: string; limit_key: string; limit_label: string; limit_value: number;
    }[]) {
      const list = limitsByPlan.get(r.plan_id) ?? [];
      list.push({ key: r.limit_key, label: r.limit_label, value: r.limit_value });
      limitsByPlan.set(r.plan_id, list);
    }

    const featuresByPlan = new Map<string, { key: string; label: string; enabled: boolean }[]>();
    for (const r of (featureRows ?? []) as {
      plan_id: string; feature_key: string; feature_label: string; enabled: boolean;
    }[]) {
      const list = featuresByPlan.get(r.plan_id) ?? [];
      list.push({ key: r.feature_key, label: r.feature_label, enabled: r.enabled });
      featuresByPlan.set(r.plan_id, list);
    }

    const { data: subRaw } = companyId
      ? await db
          .from("subscriptions")
          .select(
            "plan_id, tier, status, stripe_status, billing_cycle, is_comped, comped_until, " +
            "comped_reason, trial_ends_at, current_period_start, current_period_end, " +
            "cancel_at_period_end, past_due_since, pending_plan_id, pending_billing_cycle, " +
            "stripe_subscription_id, stripe_price_id, stripe_mode, is_paused, paused_at, " +
            "pause_resumes_at"
          )
          .eq("company_id", companyId)
          .maybeSingle()
      : { data: null };

    const sub = subRaw as {
      plan_id: string | null; tier: string; status: string; stripe_status: string | null;
      billing_cycle: string; is_comped: boolean; comped_until: string | null;
      comped_reason: string | null; trial_ends_at: string | null;
      current_period_start: string | null; current_period_end: string | null;
      cancel_at_period_end: boolean; past_due_since: string | null;
      pending_plan_id: string | null; pending_billing_cycle: string | null;
      stripe_subscription_id: string | null; stripe_price_id: string | null;
      stripe_mode: string | null;
      is_paused: boolean | null; paused_at: string | null;
      pause_resumes_at: string | null;
    } | null;

    /**
     * What this customer actually pays, versus what the plan costs today.
     *
     * Needed by the cancellation flow's "what you'd lose" step, which warns a
     * grandfathered subscriber that their rate goes away if they leave. That
     * warning must only appear when it is TRUE — telling someone already on the
     * standard rate that they will lose a discount is an invented claim, and the
     * mockup's founding-rate callout would do exactly that if rendered
     * unconditionally.
     *
     * The paid price is looked up WITHOUT `is_current`, because being on a
     * superseded row is the whole point: sync-prices retains old rows precisely
     * so grandfathered subscribers still resolve.
     */
    const { data: paidPriceRow } = sub?.stripe_price_id
      ? await db
          .from("stripe_prices")
          .select("unit_amount, currency")
          .eq("stripe_mode", STRIPE_MODE_TAG)
          .eq("stripe_price_id", sub.stripe_price_id)
          .maybeSingle()
      : { data: null };

    const paidPrice = paidPriceRow as { unit_amount: number; currency: string } | null;

    const standardPrice =
      sub?.plan_id
        ? currentPrices.find(
            (p) => p.plan_id === sub.plan_id && p.billing_cycle === sub.billing_cycle
          ) ?? null
        : null;

    /**
     * Features for the caller's OWN plan, even when that plan is retired.
     *
     * The map above is built only for ACTIVE plans, so a subscriber on a retired
     * plan had no feature list at all. Harmless for the pricing cards, which do
     * not show retired plans — but the cancellation screen lists what the
     * customer is giving up, and showing them an empty list would understate it.
     */
    if (sub?.plan_id && !featuresByPlan.has(sub.plan_id)) {
      const { data: ownFeatures } = await db
        .from("plan_features")
        .select("feature_key, feature_label, enabled")
        .eq("plan_id", sub.plan_id);

      featuresByPlan.set(
        sub.plan_id,
        ((ownFeatures ?? []) as {
          feature_key: string; feature_label: string; enabled: boolean;
        }[]).map((f) => ({ key: f.feature_key, label: f.feature_label, enabled: f.enabled }))
      );
    }

    /**
     * How much work is in the account, for the cancellation screen's "here is
     * what gets locked" list. A head-count query, so it costs nothing and
     * returns no customer data.
     */
    const { count: initiativeCount } = companyId
      ? await db
          .from("initiatives")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
      : { count: 0 };

    /**
     * Can this customer be offered a retention discount?
     *
     * Resolved HERE, not in the modal, so the cancellation flow can skip the
     * budget screen entirely for someone who cannot claim anything. Without
     * this an annual subscriber was shown two offer cards whose buttons both
     * failed — the screen was rendered purely because the reason had an offer,
     * with no reference to whether that offer could actually be granted.
     *
     * ONE CHECK IS DELIBERATELY OMITTED: whether Stripe already has a discount
     * on the subscription. Answering that needs a Stripe API call, and this
     * endpoint loads on every visit to Settings. The claim route re-runs the
     * full set including that one, and refuses with a specific
     * "already discounted" message — so the rare case fails late with accurate
     * wording rather than making every settings page load slower.
     */
    const { count: redemptionCount, error: redemptionError } = companyId
      ? await db
          .from("retention_offer_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
      : { count: 0, error: null };

    if (redemptionError) {
      // Table missing or unreadable. Treated as "already redeemed" so the
      // screen is hidden: offering something that cannot be recorded is worse
      // than not offering it.
      console.error("[billing/me] Could not read redemptions:", redemptionError.message);
    }

    /**
     * Only an owner may SEE the billing detail, not merely act on it.
     *
     * Declared here rather than beside the response because the discount
     * lookup below depends on it — there is no reason to spend a Stripe call
     * resolving a figure the caller is not allowed to be shown.
     */
    const canSeeBillingDetail = !profile?.role || profile.role === "owner";

    /**
     * The ACTIVE DISCOUNT, and what the customer will really be charged.
     *
     * Accepting a retention offer used to change nothing on this screen: the
     * panel showed the plan's list price and the renewal date, so a customer
     * who had just claimed "50% off for 2 months" saw £149 and no
     * acknowledgement. The only way to check was to re-enter the cancellation
     * flow and be told they had already used their one offer.
     *
     * GATED ON THE REDEMPTION ROW, which is already counted just above for
     * `alreadyRedeemed` and costs nothing. Only an account that has actually
     * claimed something pays for a Stripe round trip, so Settings stays as
     * fast as it was for everyone else — and that is the overwhelming
     * majority.
     *
     * KNOWN LIMITATION: a discount applied by hand in the Stripe dashboard
     * leaves no redemption row, so it will not be shown. Catching those would
     * mean a Stripe call on every load for every customer, which is not worth
     * it for an administrative edge case — and `/api/billing/retention-offer`
     * re-checks Stripe directly before granting anything, so nobody can double
     * up.
     */
    let activeDiscount: ActiveDiscount | null = null;

    if (
      canSeeBillingDetail &&
      (redemptionCount ?? 0) > 0 &&
      sub?.stripe_subscription_id &&
      sub.stripe_mode === STRIPE_MODE_TAG
    ) {
      try {
        const stripe = getStripe();

        const stripeSub = await stripe.subscriptions.retrieve(
          sub.stripe_subscription_id,
          { expand: ["discounts"] }
        );

        /**
         * `discounts` is the current field; `discount` is the legacy singular
         * one. Both are read because the API version an object comes back
         * under is not entirely in our control.
         *
         * An EMPTY array is the signal that matters here: the redemption row
         * never expires, so a customer who took "50% off for 2 months" still
         * has one a year later. Stripe is the authority on whether the
         * discount is still in force.
         */
        const discounts = (stripeSub.discounts ?? []) as unknown[];
        const legacy = (stripeSub as unknown as { discount?: unknown }).discount;
        const couponId = couponIdFromDiscount(discounts[0] ?? legacy);

        /**
         * The coupon is fetched SEPARATELY rather than expanded.
         *
         * On API version 2026-08-26.dahlia a subscription's discount carries
         * only `source.coupon` as a string id — there is no coupon object to
         * expand, and `expand: ["discounts.coupon"]` returns nothing. The
         * percent, duration and month count all live on the coupon itself, so
         * it has to be retrieved by id. See couponIdFromDiscount.
         */
        const coupon = couponId
          ? ((await stripe.coupons.retrieve(couponId)) as unknown as Record<string, unknown>)
          : null;

        if (coupon) {
          /**
           * The upcoming invoice is the AUTHORITATIVE next charge — it
           * accounts for proration, credits and tax, none of which we could
           * compute correctly from the coupon alone.
           *
           * Previewing fails for a cancelled subscription, which has no
           * upcoming invoice. That is not an error worth surfacing: the
           * discount is still describable without the figure, and
           * describeActiveDiscount omits what it does not know.
           */
          let nextChargeMinor: number | null = null;
          try {
            const preview = await stripe.invoices.createPreview({
              subscription: sub.stripe_subscription_id,
            });
            nextChargeMinor = preview.total;
          } catch (previewErr) {
            console.log(
              "[billing/me] No upcoming invoice to preview:",
              previewErr instanceof Error ? previewErr.message : previewErr
            );
          }

          activeDiscount = describeActiveDiscount({
            couponId: typeof coupon.id === "string" ? coupon.id : null,
            percentOff: typeof coupon.percent_off === "number" ? coupon.percent_off : null,
            amountOff: typeof coupon.amount_off === "number" ? coupon.amount_off : null,
            duration: typeof coupon.duration === "string" ? coupon.duration : null,
            durationInMonths:
              typeof coupon.duration_in_months === "number"
                ? coupon.duration_in_months
                : null,
            nextChargeMinor,
            standardChargeMinor: paidPrice?.unit_amount ?? null,
            currency: paidPrice?.currency ?? null,
            billingCycle: sub.billing_cycle ?? null,
          });
        }
      } catch (err) {
        /*
         * Never fails the request. The panel is perfectly usable without the
         * discount line, and billing state is what the customer came for.
         */
        console.error(
          "[billing/me] Could not read the active discount:",
          err instanceof Error ? err.message : err
        );
      }
    }

    const cancelEligibility = canCancel(
      sub
        ? {
            status: (sub.stripe_status ?? sub.status) as string,
            isComped: sub.is_comped,
            isPaused: sub.is_paused ?? false,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            // LIVE only: a canceled subscription kept on the row is not one.
            hasStripeSubscription: hasLiveStripeSubscription(sub),
            currentPeriodEnd: sub.current_period_end,
          }
        : null
    );

    const discountEligibility = canOfferDiscount({
      cancelEligible: cancelEligibility.allowed,
      billingCycle: sub?.billing_cycle ?? null,
      hasExistingDiscount: false,
      alreadyRedeemed: !!redemptionError || (redemptionCount ?? 0) > 0,
      priceMinor: paidPrice?.unit_amount ?? null,
    });

    /**
     * Can this customer pause instead of cancelling?
     *
     * Resolved here for the same reason as the discount: the flow must not
     * render an offer screen whose button the server would refuse. Pausing is
     * monthly-only — `pause_collection` suppresses invoices raised during the
     * window but does not move a renewal date, so pausing an annual subscriber
     * whose renewal is months away would cost them access and save them
     * nothing.
     */
    const pauseEligibility = canPauseSelf({
      cancelEligible: cancelEligibility.allowed,
      billingCycle: sub?.billing_cycle ?? null,
    });

    /**
     * Booking links for the two coaching-call offers.
     *
     * Sent to the client because those screens are nothing BUT a booking
     * button: with no URL the offer cannot function, so the flow drops the
     * screen rather than showing a dead button. Read tolerantly — if migration
     * 033 has not been applied the select errors, and the right outcome is
     * "those screens are off", not a broken billing page.
     */
    const { data: bookingRow, error: bookingError } = await db
      .from("app_settings")
      .select("retention_reset_call_url, retention_strategy_call_url")
      .eq("id", "global")
      .maybeSingle();

    if (bookingError) {
      console.error(
        "[billing/me] Could not read retention booking URLs:",
        bookingError.message
      );
    }

    const booking = resolveBookingUrls({
      resetCallUrl: (bookingRow as { retention_reset_call_url?: unknown } | null)
        ?.retention_reset_call_url,
      strategyCallUrl: (bookingRow as { retention_strategy_call_url?: unknown } | null)
        ?.retention_strategy_call_url,
    });

    /**
     * Is there a plan the company has actually been GIVEN, as opposed to one it
     * is merely trialing?
     *
     * A trial (migration 023) mirrors the default plan by writing that plan's id
     * onto the subscription row, with no Stripe subscription behind it. Deriving
     * "current plan" from `plan_id` alone therefore marked Starter as owned for
     * every brand-new account, so the one plan a trial user is most likely to buy
     * rendered as a disabled "Your plan" button and could not be purchased at all.
     *
     * Only two things count as genuinely holding a plan: a live Stripe
     * subscription in this mode, or a comp granted by an admin. Everything else
     * — including an in-progress trial — leaves every plan buyable.
     */
    const hasPurchasedPlan =
      !!sub &&
      (sub.is_comped ||
        (!!sub.stripe_subscription_id &&
          sub.stripe_mode === STRIPE_MODE_TAG &&
          ["active", "trialing", "past_due"].includes(sub.stripe_status ?? "")));

    const access = evaluateAccess(
      {
        stripeEnabled: config.stripeEnabled,
        trialEnabled: config.trialEnabled,
        trialDays: config.trialDays,
        dunningGraceDays: config.dunningGraceDays,
      },
      sub
        ? {
            status: (sub.stripe_status ?? sub.status) as never,
            isComped: sub.is_comped,
            compedUntil: sub.comped_until,
            trialEndsAt: sub.trial_ends_at,
            currentPeriodEnd: sub.current_period_end,
            pastDueSince: sub.past_due_since,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            isPaused: sub.is_paused ?? false,
            pauseResumesAt: sub.pause_resumes_at,
          }
        : null
    );

    // Usage for the CURRENT plan's limits, in the same period the enforcement
    // path uses, so the figures shown match the figures acted on.
    const period = resolveUsagePeriod(
      sub?.current_period_start ?? null,
      sub?.current_period_end ?? null
    );

    let usage: {
      key: string; label: string; limit: number; used: number;
      remaining: number | null; unlimited: boolean; notIncluded: boolean;
    }[] = [];

    if (companyId && sub?.plan_id) {
      const planLimits = limitsByPlan.get(sub.plan_id) ?? [];
      const { data: counters } = await db
        .from("usage_counters")
        .select("limit_key, used")
        .eq("company_id", companyId)
        .eq("period_start", period.periodStart);

      const usedByKey = new Map(
        ((counters ?? []) as { limit_key: string; used: number }[]).map((c) => [c.limit_key, c.used])
      );

      usage = planLimits.map((l) => {
        const check = checkLimit(l.value, usedByKey.get(l.key) ?? 0);
        return {
          key: l.key,
          label: l.label,
          limit: check.limit,
          used: check.used,
          remaining: check.remaining,
          unlimited: check.unlimited,
          notIncluded: check.notIncluded,
        };
      });
    }

    const { data: invoices } = companyId
      ? await db
          .from("billing_invoices")
          .select("stripe_invoice_id, status, amount_paid, currency, paid_at, hosted_invoice_url, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(12)
      : { data: [] };

    /**
     * Only an owner may SEE the billing detail, not merely act on it.
     *
     * `canManage` already hid the buttons, but the payload itself still
     * carried the plan, the price, the renewal date and up to twelve invoices
     * — including `hosted_invoice_url`, which links straight to the document
     * in Stripe — to any authenticated member who asked. The Settings tab is
     * now owner-only too, so nothing legitimate calls this as a non-owner;
     * this is the second lock, for anyone calling the endpoint directly.
     *
     * The ENVELOPE is kept rather than returning 403, because the response
     * also carries the access state the app uses for gating. A non-owner gets
     * a truthful "there is nothing here for you" instead of an error that a
     * caller would have to special-case.
     */
    if (!canSeeBillingDetail) {
      console.log("[billing/me]", user.email, "is", profile?.role, "— billing detail withheld");

      return NextResponse.json({
        billingEnabled: config.stripeEnabled,
        canManage: false,
        /** Withheld, not empty: the distinction matters when debugging. */
        restricted: true,
        trial: {
          enabled: config.trialEnabled,
          days: config.trialDays,
          requiresCard: config.trialRequiresCard,
        },
        plans: [],
        subscription: null,
        invoices: [],
        activeDiscount: null,
        counts: { initiatives: initiativeCount ?? 0 },
        access: {
          allowed: access.allowed,
          reason: access.reason,
          warn: access.warn,
          daysRemaining: access.daysRemaining,
        },
      });
    }

    return NextResponse.json({
      billingEnabled: config.stripeEnabled,
      // Only an owner may buy or change a plan; the UI hides the buttons for
      // everyone else rather than letting them fail at the API.
      canManage: canSeeBillingDetail,
      trial: {
        enabled: config.trialEnabled,
        days: config.trialDays,
        requiresCard: config.trialRequiresCard,
      },
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        tagline: p.tagline,
        monthlyPrice: p.monthly_price,
        annualPrice: p.annual_price,
        isDefault: p.is_default,
        // Never true during a trial — see hasPurchasedPlan above.
        isCurrent: hasPurchasedPlan && sub?.plan_id === p.id,
        purchasableMonthly: purchasable.has(`${p.id}:monthly`),
        purchasableAnnual: purchasable.has(`${p.id}:annual`),
        limits: limitsByPlan.get(p.id) ?? [],
        features: featuresByPlan.get(p.id) ?? [],
      })),
      subscription: sub
        ? {
            planId: sub.plan_id,
            // Resolved against ALL plans, so a retired plan still has a name.
            // `sub.tier` remains the last resort for rows with no plan_id at all.
            planName:
              allPlans.find((p) => p.id === sub.plan_id)?.name ?? sub.tier,
            /**
             * The plan exists but is no longer sold. The UI says so plainly
             * rather than implying the customer was moved or must act — their
             * price and limits are untouched.
             */
            planRetired:
              !!sub.plan_id &&
              allPlans.some((p) => p.id === sub.plan_id && !p.is_active),
            billingCycle: sub.billing_cycle,
            status: sub.stripe_status ?? sub.status,
            isComped: sub.is_comped,
            compedUntil: sub.comped_until,
            compedReason: sub.comped_reason,
            trialEndsAt: sub.trial_ends_at,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            isPaused: sub.is_paused ?? false,
            pausedAt: sub.paused_at,
            pauseResumesAt: sub.pause_resumes_at,
            // `pause_reason` is deliberately NOT exposed: it is an internal
            // admin note and may say "non-payment" or "contract dispute".
            // Also resolved against ALL plans: a scheduled downgrade to a plan
            // retired after it was scheduled must still show its name.
            pendingPlanName: sub.pending_plan_id
              ? allPlans.find((p) => p.id === sub.pending_plan_id)?.name ?? null
              : null,
            pendingBillingCycle: sub.pending_billing_cycle,
            /**
             * A LIVE Stripe subscription in this mode (active, trialing,
             * past_due, unpaid). Drives Change plan vs Checkout in the panel,
             * and the portal link.
             *
             * It used to be "an id is stored", which stayed true for a
             * subscription Stripe had already CANCELED — e.g. after a comp was
             * granted then revoked — so the panel offered "Switch to this plan"
             * and change-plan could only answer `no_change` or fail. A
             * non-live subscription is now treated as none, so the customer
             * is sent to Checkout.
             */
            hasStripeSubscription: hasLiveStripeSubscription(sub),
            /**
             * Minor units, as Stripe reports them. Both nullable: a comped or
             * trialing account has no Stripe price, and the cancellation screen
             * must render without inventing a figure.
             */
            currentPriceMinor: paidPrice?.unit_amount ?? null,
            standardPriceMinor: standardPrice?.unit_amount ?? null,
            priceCurrency: paidPrice?.currency ?? standardPrice?.currency ?? "usd",
            /**
             * True only when they genuinely pay less than today's rate. This is
             * what gates the "your rate goes away" warning, so it is computed
             * from two real figures rather than inferred from planRetired — a
             * plan can be retired while its price is unchanged, and a price can
             * be superseded while the plan is still sold.
             */
            onLegacyPrice:
              typeof paidPrice?.unit_amount === "number" &&
              typeof standardPrice?.unit_amount === "number" &&
              paidPrice.unit_amount < standardPrice.unit_amount,
            // What the customer keeps or loses, resolved even for a retired plan.
            planFeatures: sub.plan_id ? featuresByPlan.get(sub.plan_id) ?? [] : [],
            /**
             * Whether the cancellation flow should show its budget screen.
             * False for annual subscribers, anyone who already used their one
             * offer, and anyone who could not cancel anyway.
             */
            discountOfferAvailable: discountEligibility.allowed,
            /** Whether the cancellation flow should offer a pause. */
            pauseOfferAvailable: pauseEligibility.allowed,
            /**
             * Booking links, null when unset. Null hides the matching screen,
             * which is how an operator switches those offers off.
             */
            resetCallUrl: booking.resetCall,
            strategyCallUrl: booking.strategyCall,
          }
        : null,
      /**
       * The discount actually in force, or null. See discount-display.ts for
       * why the panel could not previously tell the customer anything about an
       * offer they had just accepted.
       */
      activeDiscount,
      // Account contents, for the cancellation screen's "what gets locked" list.
      counts: { initiatives: initiativeCount ?? 0 },
      access: {
        allowed: access.allowed,
        reason: access.reason,
        warn: access.warn,
        daysRemaining: access.daysRemaining,
      },
      usage,
      periodEnd: period.periodEnd,
      invoices: invoices ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/me] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
