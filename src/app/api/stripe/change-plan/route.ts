import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { changeCompanyPlan } from "@/lib/billing/change-company-plan";

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

    const outcome = await changeCompanyPlan(db, profile.company_id, targetPlanId, body);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe/change-plan] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
