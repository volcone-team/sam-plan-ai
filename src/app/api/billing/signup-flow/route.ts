import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { firstSignupStep } from "@/lib/billing/signup-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/signup-flow — must a plan be chosen before registering?
 *
 * PUBLIC, and deliberately minimal. The signup page is reached by anonymous
 * visitors, so there is no session to authorise with, and the answer is not
 * sensitive: it reveals only whether a free trial is currently offered, which
 * the pricing page states anyway.
 *
 * Returns ONE boolean rather than the billing config. An unauthenticated
 * caller has no business knowing trial lengths, plan ids or Stripe state, and
 * a route that returns the whole settings row would leak all of it.
 *
 * Exists because the plan-first rule has to apply to EVERY entry point. Six
 * places link to signup and the route is reachable directly, so gating it at
 * each link guarantees the next one added misses the rule.
 */
export async function GET() {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const config = await loadBillingConfig(db);

    const step = firstSignupStep({
      trialEnabled: config.trialEnabled,
      stripeEnabled: config.stripeEnabled,
    });

    return NextResponse.json({ requiresPlanFirst: step === "choose_plan" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/signup-flow] failed:", message);

    /*
     * Fails OPEN: no plan requirement. A settings read failure must not block
     * registration — a plan can still be bought afterwards through the
     * entitlement gate, whereas a signup page that refuses to load loses the
     * customer for good.
     */
    return NextResponse.json({ requiresPlanFirst: false });
  }
}
