import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { fromMinorUnits } from "@/lib/billing/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/billing/overview
 *
 * Real revenue summary for the Subscriptions overview, replacing the hardcoded
 * mock ($347 MRR, 1 subscriber, etc.) that the prototype shipped.
 *
 * All figures are AGGREGATES across every subscription, so this is intentionally
 * separate from /api/admin/subscribers, which paginates and therefore cannot sum
 * the whole set. Super-admin only.
 *
 * MRR counts only genuinely-billing subscriptions (active or past_due, not
 * trialing or comped — neither pays), and normalises annual plans to a monthly
 * figure so the number means what "monthly recurring revenue" should.
 */
export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();

    const [subsRes, plansRes, paidRes] = await Promise.all([
      db
        .from("subscriptions")
        .select("plan_id, tier, stripe_status, status, billing_cycle, is_comped"),
      db
        .from("subscription_plans")
        .select("id, name, monthly_price, annual_price, display_order")
        .order("display_order"),
      /**
       * Collected to date, from stored invoices (webhook-populated).
       *
       * company_id NOT NULL is load-bearing, not tidiness: an invoice that
       * belongs to no company in this database is not this platform's revenue.
       * Historic rows imported from unrelated Stripe customers are excluded
       * here so the headline figure cannot be inflated by them.
       */
      db
        .from("billing_invoices")
        .select("amount_paid, status")
        .not("company_id", "is", null),
    ]);

    if (subsRes.error) {
      console.error("[admin/billing/overview] subs query failed:", subsRes.error.message);
      return NextResponse.json({ error: subsRes.error.message }, { status: 500 });
    }

    const plans = (plansRes.data ?? []) as {
      id: string; name: string; monthly_price: number; annual_price: number; display_order: number;
    }[];
    const planById = new Map(plans.map((p) => [p.id, p]));

    const subs = (subsRes.data ?? []) as {
      plan_id: string | null; tier: string; stripe_status: string | null;
      status: string | null; billing_cycle: string; is_comped: boolean;
    }[];

    // Per-plan subscriber counts and the monthly-equivalent revenue each produces.
    const perPlan = new Map<string, { name: string; subscribers: number; mrr: number; monthlyPrice: number }>();
    for (const p of plans) {
      perPlan.set(p.id, { name: p.name, subscribers: 0, mrr: 0, monthlyPrice: Number(p.monthly_price) || 0 });
    }

    let mrr = 0;
    let payingCount = 0;
    let trialingCount = 0;
    let compedCount = 0;

    for (const sub of subs) {
      const effective = sub.stripe_status ?? sub.status;

      if (sub.is_comped) { compedCount += 1; continue; }
      if (effective === "trialing" || effective === "trial") { trialingCount += 1; continue; }

      // Only genuinely-billing states contribute to MRR.
      if (effective !== "active" && effective !== "past_due") continue;

      const plan = sub.plan_id ? planById.get(sub.plan_id) : null;
      if (!plan) continue;

      // Annual normalised to a monthly figure so MRR is comparable across cycles.
      const monthly =
        sub.billing_cycle === "annual"
          ? (Number(plan.annual_price) || 0) / 12
          : Number(plan.monthly_price) || 0;

      mrr += monthly;
      payingCount += 1;

      const bucket = perPlan.get(plan.id);
      if (bucket) {
        bucket.subscribers += 1;
        bucket.mrr += monthly;
      }
    }

    const collectedMinor = ((paidRes.data ?? []) as { amount_paid: number | null; status: string | null }[])
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + (i.amount_paid ?? 0), 0);

    return NextResponse.json({
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(mrr * 12 * 100) / 100,
      payingSubscribers: payingCount,
      trialing: trialingCount,
      comped: compedCount,
      totalAccounts: subs.length,
      collectedToDate: fromMinorUnits(collectedMinor),
      byPlan: plans.map((p) => {
        const b = perPlan.get(p.id)!;
        return {
          planId: p.id,
          name: p.name,
          monthlyPrice: Number(p.monthly_price) || 0,
          subscribers: b.subscribers,
          mrr: Math.round(b.mrr * 100) / 100,
        };
      }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/billing/overview] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
