import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { loadBillingConfig, STRIPE_MODE_TAG } from "@/lib/billing/stripe-client";
import { changeCompanyPlan } from "@/lib/billing/change-company-plan";

export const runtime = "nodejs";

/**
 * Super admin: change a company's Stripe plan on the client's request.
 *
 *   GET  -> the company's current plan and cycle, and every plan it could move
 *           to (active plans with a current Stripe price), for the dialog.
 *   POST -> { planId, billingCycle } runs the SAME logic as the owner's own
 *           Settings change (changeCompanyPlan): an upgrade or cycle change
 *           applies now and CHARGES the customer's card a prorated amount; a
 *           downgrade is scheduled for the end of the period.
 *
 * Super admins only, because it moves real money. The page asks for explicit
 * confirmation before it calls POST. Every change is logged with the admin.
 */

const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireSuperAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { id } = await params;
  const db = adminClient();

  const [{ data: sub }, { data: plans }, { data: prices }] = await Promise.all([
    db
      .from("subscriptions")
      .select("plan_id, billing_cycle, stripe_subscription_id, stripe_status, status, is_comped, is_paused, pending_plan_id")
      .eq("company_id", id)
      .maybeSingle(),
    db.from("subscription_plans").select("id, name, monthly_price, annual_price, display_order").eq("is_active", true).order("display_order"),
    db.from("stripe_prices").select("plan_id, billing_cycle").eq("stripe_mode", STRIPE_MODE_TAG).eq("is_current", true),
  ]);

  const priced = new Set(((prices ?? []) as { plan_id: string; billing_cycle: string }[]).map((p) => `${p.plan_id}:${p.billing_cycle}`));
  const live = !!sub?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(String(sub?.stripe_status ?? ""));

  return NextResponse.json({
    current: sub
      ? { planId: sub.plan_id, billingCycle: sub.billing_cycle, pendingPlanId: sub.pending_plan_id, isComped: !!sub.is_comped, isPaused: !!sub.is_paused, live }
      : null,
    plans: ((plans ?? []) as { id: string; name: string; monthly_price: number; annual_price: number }[]).map((p) => ({
      id: p.id,
      name: p.name,
      monthlyPrice: Number(p.monthly_price) || 0,
      annualPrice: Number(p.annual_price) || 0,
      cycles: (["monthly", "annual"] as const).filter((c) => priced.has(`${p.id}:${c}`)),
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const { id } = await params;

    let body: { planId?: unknown; billingCycle?: unknown; confirm?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }
    // The dialog sends confirm: true; a stray request without it does nothing.
    if (body.confirm !== true) return NextResponse.json({ error: "confirm_required" }, { status: 400 });
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return NextResponse.json({ error: "planId" }, { status: 400 });

    const db = adminClient();
    const config = await loadBillingConfig(db);
    if (!config.stripeEnabled) return NextResponse.json({ error: "billing_disabled" }, { status: 403 });

    const { data: company } = await db.from("companies").select("id").eq("id", id).maybeSingle();
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    console.log("[admin/change-plan] admin", check.userId, "changing plan for company", id, "->", planId, body.billingCycle ?? "(same cycle)");
    const outcome = await changeCompanyPlan(db, id, planId, { billingCycle: body.billingCycle });
    console.log("[admin/change-plan] result", outcome.status, JSON.stringify(outcome.body));
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/change-plan] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
