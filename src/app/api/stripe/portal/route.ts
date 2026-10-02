import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getStripe, loadBillingConfig, STRIPE_MODE_TAG } from "@/lib/billing/stripe-client";
import { getAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST /api/stripe/portal
 *
 * Returns a Stripe Billing Portal URL for the caller's company.
 *
 * Stripe hosts card updates, invoice history and cancellation. Building those
 * ourselves would mean handling card data, reimplementing dunning UI, and
 * keeping cancellation semantics in sync with Stripe's — all of which the portal
 * already does correctly and for free.
 *
 * Owner-only: the portal can cancel the subscription and change payment methods,
 * which is not something any team member should be able to do.
 *
 * Responses:
 *   200 { url }
 *   401 { error: "Unauthorized" }
 *   403 { error: "not_permitted" | "billing_disabled" }
 *   404 { error: "no_customer" }
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
      return NextResponse.json({ error: "billing_disabled" }, { status: 403 });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.company_id) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    if (profile.role && profile.role !== "owner") {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }

    const { data: sub } = await db
      .from("subscriptions")
      .select("stripe_customer_id, stripe_mode")
      .eq("company_id", profile.company_id)
      .maybeSingle();

    if (!sub?.stripe_customer_id || sub.stripe_mode !== STRIPE_MODE_TAG) {
      return NextResponse.json({ error: "no_customer" }, { status: 404 });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${getAppUrl()}/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe/portal] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
