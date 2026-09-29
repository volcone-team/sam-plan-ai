import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getStripe, loadBillingConfig } from "@/lib/billing/stripe-client";
import { classifyPlanChange, changeTiming } from "@/lib/billing/limits";

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

    const kind = classifyPlanChange(
      {
        planId: sub.plan_id ?? "",
        cycle: sub.billing_cycle as string,
        price: currentRow?.unit_amount ?? 0,
      },
      { planId: targetPlanId, cycle: targetCycle, price: target.unit_amount }
    );

    if (kind === "same") {
      return NextResponse.json({ error: "no_change" }, { status: 400 });
    }

    const timing = changeTiming(kind);
    const stripe = getStripe(config.mode);
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) {
      return NextResponse.json({ error: "no_subscription_item" }, { status: 500 });
    }

    if (timing === "immediate") {
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: itemId, price: target.stripe_price_id }],
        // Bill the difference now rather than deferring it: the customer is
        // getting the higher tier immediately, so the charge should match.
        proration_behavior: "always_invoice",
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

    // Downgrade: schedule at period end via a subscription schedule so Stripe
    // itself performs the switch. Doing it with a cron job on our side would
    // drift from Stripe's clock and could miss or double-apply.
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: sub.stripe_subscription_id,
    });

    const currentPhase = schedule.phases[0];
    await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: [{ price: sub.stripe_price_id!, quantity: 1 }],
          start_date: currentPhase.start_date,
          end_date: currentPhase.end_date,
        },
        {
          items: [{ price: target.stripe_price_id, quantity: 1 }],
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
