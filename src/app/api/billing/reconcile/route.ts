import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getStripe, loadBillingConfig, type StripeMode } from "@/lib/billing/stripe-client";
import {
  mapStripeStatus,
  extractPeriod,
  shouldClearComp,
  shouldClearPending,
  isEnding,
} from "@/lib/billing/webhook-logic";
import { isLiveSubscription } from "@/lib/billing/plan-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/reconcile
 *
 * Reconciles the CALLER'S OWN subscription from Stripe. Safe for any signed-in
 * user: it can only ever read Stripe and copy the result onto their own company,
 * so the worst it can do is make their record accurate.
 *
 * WHY THIS EXISTS — a genuine gap, not a workaround:
 *
 * The webhook is the only writer of subscription state, and Stripe cannot deliver
 * webhooks to localhost. So during local development a payment succeeds in Stripe
 * and the app never learns about it. `stripe listen` solves that, but it is an
 * extra process that must be running, and forgetting it looks exactly like a bug.
 *
 * It matters in production too: webhooks can be delayed, and a customer returning
 * from Checkout expects their plan to have changed NOW, not whenever an
 * asynchronous delivery lands. So /settings calls this on returning from
 * Checkout, making the success path self-healing rather than dependent on timing.
 *
 * This does NOT replace the webhook. Renewals, failed payments and cancellations
 * all happen with nobody looking at the page, so the webhook remains essential.
 * This only closes the window right after a purchase.
 */
export async function POST() {
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
    if (!config.stripeEnabled) {
      return NextResponse.json({ reconciled: false, reason: "billing_disabled" });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = profile?.company_id ?? null;
    if (!companyId) {
      return NextResponse.json({ reconciled: false, reason: "no_company" });
    }

    const mode: StripeMode = config.mode;
    const stripe = getStripe(mode);

    const { data: row } = await db
      .from("subscriptions")
      .select("stripe_customer_id, stripe_mode, past_due_since")
      .eq("company_id", companyId)
      .maybeSingle();

    let customerId =
      row?.stripe_mode === mode ? (row?.stripe_customer_id as string) ?? null : null;

    /**
     * No stored customer id: find one by email.
     *
     * This is the case that matters locally. Checkout stores the customer id
     * before redirecting, but if that write was lost — or the account was
     * recreated — the link is missing and the payment can never be matched.
     * Searching by email recovers it.
     */
    if (!customerId && user.email) {
      const found = await stripe.customers.list({ email: user.email, limit: 10 });
      // Newest first, so a re-created customer wins over an abandoned one.
      const candidate = found.data.sort((a, b) => b.created - a.created)[0];
      if (candidate) {
        customerId = candidate.id;
        console.log("[billing/reconcile] Recovered customer by email for", user.email);
      }
    }

    if (!customerId) {
      return NextResponse.json({ reconciled: false, reason: "no_stripe_customer" });
    }

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });

    // Prefer a live subscription; fall back to the newest so a cancellation is
    // reflected rather than leaving stale access in place.
    const live = subs.data.find((s) => isLiveSubscription(s.status));
    const sub = live ?? subs.data.sort((a, b) => b.created - a.created)[0] ?? null;

    if (!sub) {
      // Record the customer id even with no subscription, so a later purchase
      // can be matched without another email lookup.
      await db
        .from("subscriptions")
        .update({
          stripe_customer_id: customerId,
          stripe_mode: mode,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);
      return NextResponse.json({ reconciled: false, reason: "no_subscription" });
    }

    const item = sub.items.data[0];
    const priceId = item?.price?.id ?? null;
    const interval = item?.price?.recurring?.interval;
    const { start: periodStart, end: periodEnd } = extractPeriod(
      sub as unknown as Parameters<typeof extractPeriod>[0]
    );

    // Resolve the plan from metadata first, then from the price. NOT filtered on
    // is_current: a grandfathered subscriber sits on a superseded price.
    let planId: string | null = sub.metadata?.plan_id ?? null;
    if (!planId && priceId) {
      const { data: priceRow } = await db
        .from("stripe_prices")
        .select("plan_id")
        .eq("stripe_mode", mode)
        .eq("stripe_price_id", priceId)
        .maybeSingle();
      planId = (priceRow?.plan_id as string) ?? null;
    }

    const patch: Record<string, unknown> = {
      stripe_mode: mode,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      stripe_status: sub.status,
      status: mapStripeStatus(sub.status),
      billing_cycle: interval === "year" ? "annual" : "monthly",
      // Covers both cancel_at_period_end and a dated cancel_at (billing portal).
      cancel_at_period_end: isEnding(sub),
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      is_trial_active: sub.status === "trialing",
      // Null when ending, or the UI reports a cancelled plan as renewing.
      renewal_date: isEnding(sub) || !periodEnd
        ? null
        : new Date(periodEnd * 1000).toISOString(),
      cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    if (planId) patch.plan_id = planId;

    if (shouldClearComp(sub.status)) {
      patch.is_comped = false;
      patch.comped_until = null;
      patch.comped_reason = null;
      patch.past_due_since = null;
    }
    if (shouldClearPending(sub.status)) {
      patch.pending_plan_id = null;
      patch.pending_billing_cycle = null;
    }

    const { error } = await db
      .from("subscriptions")
      .update(patch)
      .eq("company_id", companyId);

    if (error) {
      console.error("[billing/reconcile] Update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Invoices too, so payment history is not left empty by the same gap.
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 24 });
    for (const inv of invoices.data) {
      if (!inv.id) continue;
      const line = inv.lines?.data?.[0];
      await db.from("billing_invoices").upsert(
        {
          company_id: companyId,
          stripe_mode: mode,
          stripe_invoice_id: inv.id,
          stripe_customer_id: customerId,
          status: inv.status ?? null,
          amount_due: inv.amount_due ?? null,
          amount_paid: inv.amount_paid ?? null,
          currency: inv.currency ?? "usd",
          description: inv.description ?? line?.description ?? null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          invoice_pdf: inv.invoice_pdf ?? null,
          paid_at:
            inv.status === "paid" && inv.status_transitions?.paid_at
              ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
              : null,
          attempt_count: inv.attempt_count ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_mode,stripe_invoice_id" }
      );
    }

    console.log(
      "[billing/reconcile]", user.email, "→", sub.status, priceId ?? "no price"
    );

    return NextResponse.json({
      reconciled: true,
      status: sub.status,
      planId,
      invoices: invoices.data.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/reconcile] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
