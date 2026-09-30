import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getStripe, loadBillingConfig } from "@/lib/billing/stripe-client";
import { classifyPlanChange, changeTiming } from "@/lib/billing/limits";
import { findCurrentPhase, scheduleActionFor } from "@/lib/billing/plan-change";

export const runtime = "nodejs";

/**
 * POST /api/stripe/change-plan
 *
 * Moves an existing subscription to a different plan or billing cycle.
 *
 * TIMING IS ASYMMETRIC, ON PURPOSE:
 *
 *   UPGRADE   -> immediate, with proration. The customer pays the difference for
 *                the remainder of the period and gets the higher limits now.
 *                Making someone wait for capacity they just paid for would be
 *                indefensible.
 *
 *   DOWNGRADE -> at period end. They have already paid for this period, so
 *                cutting access early takes away purchased value; refunding the
 *                difference instead invites upgrade/downgrade churn for credit.
 *                Stored in pending_plan_id and applied by Stripe at renewal.
 *
 *   CYCLE     -> immediate. Monthly to annual credits the unused monthly
 *                remainder, which is what Stripe proration does naturally.
 *
 * Usage counters are NOT reset by any of these. See lib/billing/limits.ts: the
 * ceiling moves, consumption stands. Resetting would let a customer cycle plans
 * to mint unlimited paid AI usage.
 *
 * Body: { planId: string, billingCycle?: 'monthly' | 'annual' }
 */
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

    let body: { planId?: unknown; billingCycle?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }

    const targetPlanId = typeof body.planId === "string" ? body.planId : "";
    if (!targetPlanId) return NextResponse.json({ error: "planId" }, { status: 400 });

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const config = await loadBillingConfig(db);
    if (!config.stripeEnabled) {
      return NextResponse.json({ error: "billing_disabled" }, { status: 403 });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.company_id || (profile.role && profile.role !== "owner")) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }

    const { data: sub } = await db
      .from("subscriptions")
      .select("id, plan_id, billing_cycle, stripe_subscription_id, stripe_mode, stripe_price_id, is_comped")
      .eq("company_id", profile.company_id)
      .maybeSingle();

    if (sub?.is_comped) {
      // A comped account has no Stripe subscription to modify.
      return NextResponse.json({ error: "comped_account" }, { status: 400 });
    }
    if (!sub?.stripe_subscription_id || sub.stripe_mode !== config.mode) {
      return NextResponse.json({ error: "no_subscription" }, { status: 404 });
    }

    const targetCycle =
      body.billingCycle === "annual"
        ? "annual"
        : body.billingCycle === "monthly"
          ? "monthly"
          : (sub.billing_cycle as string);

    // Fetched BEFORE classification: the price Stripe is actually charging is the
    // fallback when our own price table cannot identify the current amount.
    const stripeSubEarly = await getStripe(config.mode).subscriptions.retrieve(
      sub.stripe_subscription_id
    );

    // Prices for both ends of the change, to classify it and to set the new item.
    const { data: prices } = await db
      .from("stripe_prices")
      .select("plan_id, billing_cycle, stripe_price_id, unit_amount, is_current")
      .eq("stripe_mode", config.mode)
      .in("plan_id", [targetPlanId, sub.plan_id].filter(Boolean) as string[]);

    const rows = (prices ?? []) as {
      plan_id: string; billing_cycle: string; stripe_price_id: string;
      unit_amount: number; is_current: boolean;
    }[];

    const target = rows.find(
      (r) => r.plan_id === targetPlanId && r.billing_cycle === targetCycle && r.is_current
    );
    if (!target) {
      return NextResponse.json({ error: "price_not_found" }, { status: 404 });
    }

    // The CURRENT price is looked up by its exact id rather than by is_current,
    // because a grandfathered subscriber is legitimately on a superseded price —
    // and that older amount is what the change must be compared against.
    const currentRow = rows.find((r) => r.stripe_price_id === sub.stripe_price_id);

    /**
     * Ask STRIPE for the amount actually being charged when our own row cannot
     * supply it.
     *
     * Falling back to 0 (as this did) made every change look like an UPGRADE,
     * because any target price beats zero. On the top plan that meant a downgrade
     * was classified as an upgrade and applied immediately at a lower price —
     * or refused as "no change" — so there was no way back down.
     *
     * Stripe holds the price the customer is genuinely on, which is the only
     * trustworthy basis for the comparison.
     */
    let currentAmount = currentRow?.unit_amount ?? null;
    if (currentAmount === null) {
      const stripeAmount = stripeSubEarly?.items.data[0]?.price?.unit_amount ?? null;
      if (stripeAmount !== null) {
        currentAmount = stripeAmount;
        console.log(
          "[stripe/change-plan] Current price not in our table; using Stripe amount",
          stripeAmount
        );
      }
    }

    if (currentAmount === null) {
      // Without a current amount, upgrade vs downgrade cannot be decided, and
      // guessing would either overcharge or hand out a cheaper plan immediately.
      console.error(
        "[stripe/change-plan] Cannot determine current price for", sub.stripe_subscription_id
      );
      return NextResponse.json({ error: "current_price_unknown" }, { status: 409 });
    }

    const kind = classifyPlanChange(
      {
        planId: sub.plan_id ?? "",
        cycle: sub.billing_cycle as string,
        price: currentAmount,
      },
      { planId: targetPlanId, cycle: targetCycle, price: target.unit_amount }
    );

    if (kind === "same") {
      return NextResponse.json({ error: "no_change" }, { status: 400 });
    }

    const timing = changeTiming(kind);
    const stripe = getStripe(config.mode);
    // Reused from the classification step above rather than fetched twice.
    const stripeSub = stripeSubEarly;
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) {
      return NextResponse.json({ error: "no_subscription_item" }, { status: 500 });
    }

    if (timing === "immediate") {
      /**
       * A pending downgrade must be cancelled before an upgrade can apply.
       * Stripe refuses item edits on a scheduled subscription, and leaving the
       * schedule in place would silently revert the upgrade at period end.
       *
       * `release` detaches the schedule and leaves the subscription running,
       * unlike `cancel`, which would end the subscription itself.
       */
      if (stripeSub.schedule) {
        const scheduleId =
          typeof stripeSub.schedule === "string" ? stripeSub.schedule : stripeSub.schedule.id;
        try {
          await stripe.subscriptionSchedules.release(scheduleId);
          console.log("[stripe/change-plan] Released pending schedule", scheduleId);
        } catch (err: unknown) {
          console.error(
            "[stripe/change-plan] Could not release schedule:",
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: itemId, price: target.stripe_price_id }],
        // Bill the difference now rather than deferring it: the customer is
        // getting the higher tier immediately, so the charge should match.
        proration_behavior: "always_invoice",
        // Charge the prorated amount straight away instead of parking it on the
        // next invoice. Without this an upgrade appears to cost nothing at the
        // time, which is what made the Mastery switch look free.
        payment_behavior: "pending_if_incomplete",
        metadata: { ...stripeSub.metadata, plan_id: targetPlanId },
      });

      // The webhook writes the authoritative row; this keeps the UI honest in
      // the seconds before it lands.
      await db
        .from("subscriptions")
        .update({
          plan_id: targetPlanId,
          stripe_price_id: target.stripe_price_id,
          billing_cycle: targetCycle,
          pending_plan_id: null,
          pending_billing_cycle: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

      console.log("[stripe/change-plan]", kind, "applied immediately for", profile.company_id);
      return NextResponse.json({ applied: "immediate", kind });
    }

    /**
     * Downgrade: switch at period end via a subscription schedule, so Stripe
     * performs the change on its own clock. A cron job on our side would drift
     * and could miss or double-apply it.
     *
     * REUSE an existing schedule rather than creating one. A subscription can
     * only ever be attached to a single schedule, so calling create() a second
     * time fails with "You cannot migrate a subscription that is already attached
     * to a schedule" — which is exactly what happened when a customer changed
     * their mind about a pending downgrade. Retrieving and rewriting the phases
     * makes changing a scheduled downgrade work as many times as they like.
     */
    const existingSchedule = stripeSub.schedule
      ? await stripe.subscriptionSchedules.retrieve(
          typeof stripeSub.schedule === "string" ? stripeSub.schedule : stripeSub.schedule.id
        )
      : null;

    // Decided by a tested pure function rather than inline conditionals — this is
    // where the "already attached to a schedule" failure came from.
    const action = scheduleActionFor({
      timing,
      hasSchedule: !!existingSchedule,
      scheduleStatus: existingSchedule?.status ?? null,
    });

    const schedule =
      action === "reuse" && existingSchedule
        ? existingSchedule
        : await stripe.subscriptionSchedules.create({
            from_subscription: sub.stripe_subscription_id,
          });

    // A subscription created from a schedule defaults to end_behavior 'cancel',
    // which would turn a downgrade into a cancellation. Set below on update.

    // The CURRENT phase is the one containing now — not necessarily phases[0],
    // which on a reused schedule may be a phase that has already elapsed.
    const currentPhase = findCurrentPhase(schedule.phases, Math.floor(Date.now() / 1000));
    if (!currentPhase) {
      return NextResponse.json({ error: "no_schedule_phase" }, { status: 500 });
    }

    // Price the current phase from what Stripe has, not from our row: on a reused
    // schedule our stripe_price_id may already describe a pending change.
    const currentPhasePrice =
      currentPhase.items?.[0]?.price ?? sub.stripe_price_id;
    const currentPriceId =
      typeof currentPhasePrice === "string" ? currentPhasePrice : currentPhasePrice?.id;

    if (!currentPriceId) {
      return NextResponse.json({ error: "no_current_price" }, { status: 500 });
    }

    /**
     * `end_behavior: 'release'` is REQUIRED here.
     *
     * Stripe rejects a schedule whose final phase has no `duration` or `end_date`
     * unless the schedule releases at the end:
     *   "The last phase must specify either duration or end_date if end_behavior
     *    is not release."
     *
     * Release is also the behaviour we want: once the downgrade has taken effect
     * the schedule detaches and the subscription simply continues on the new
     * plan, renewing normally. The alternative ('cancel') would END the
     * subscription at the end of the phase — a downgrade would silently become a
     * cancellation, which is the worst possible outcome for a paying customer.
     */
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          items: [{ price: currentPriceId, quantity: 1 }],
          start_date: currentPhase.start_date,
          end_date: currentPhase.end_date,
        },
        {
          items: [{ price: target.stripe_price_id, quantity: 1 }],
          // No end_date: with end_behavior 'release' the schedule hands control
          // back to the subscription after this phase begins.
        },
      ],
    });

    await db
      .from("subscriptions")
      .update({
        pending_plan_id: targetPlanId,
        pending_billing_cycle: targetCycle,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    console.log("[stripe/change-plan] downgrade scheduled for", profile.company_id);
    return NextResponse.json({
      applied: "period_end",
      kind,
      effectiveAt: currentPhase.end_date
        ? new Date(currentPhase.end_date * 1000).toISOString()
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe/change-plan] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
