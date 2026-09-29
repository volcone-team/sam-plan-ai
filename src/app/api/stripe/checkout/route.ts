import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getStripe,
  loadBillingConfig,
  isModeConfigured,
  type StripeMode,
} from "@/lib/billing/stripe-client";
import { getAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST /api/stripe/checkout
 *
 * Starts a Stripe Checkout session for the caller's company and returns the URL
 * to redirect to.
 *
 * THIS ROUTE GRANTS NOTHING. It does not mark anyone active, paid, or
 * subscribed — only the webhook does that, because only Stripe knows whether
 * money actually moved. A browser can be closed mid-payment, and a success
 * redirect can be forged by typing the URL, so treating "user came back from
 * checkout" as proof of payment would hand out free subscriptions.
 *
 * Hosted Checkout rather than embedded Elements: Stripe hosts the card form, so
 * card data never touches this app and PCI scope stays minimal. It also handles
 * 3DS, wallets and tax collection without extra work here.
 *
 * Body: { planId: string, billingCycle: 'monthly' | 'annual' }
 *
 * Responses:
 *   200 { url }
 *   400 { error: "planId" | "billingCycle" | "already_subscribed" }
 *   401 { error: "Unauthorized" }
 *   403 { error: "billing_disabled" | "not_permitted" }
 *   404 { error: "price_not_found" }
 *   503 { error: "not_configured" }
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

    const planId = typeof body.planId === "string" ? body.planId : "";
    const billingCycle = body.billingCycle === "annual" ? "annual" : "monthly";
    if (!planId) return NextResponse.json({ error: "planId" }, { status: 400 });

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const config = await loadBillingConfig(db);
    if (!config.stripeEnabled) {
      // Nothing to pay for while billing is off — the app is open to everyone.
      return NextResponse.json({ error: "billing_disabled" }, { status: 403 });
    }

    const mode: StripeMode = config.mode;
    if (!isModeConfigured(mode)) {
      console.error("[stripe/checkout] Mode not configured:", mode);
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    // Only an owner may commit the company to a recurring charge. Any member
    // could otherwise sign the business up for a subscription.
    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = profile?.company_id ?? null;
    if (!companyId) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    if (profile?.role && profile.role !== "owner") {
      console.log("[stripe/checkout] Refused for non-owner", user.email, "role:", profile.role);
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }

    const { data: price } = await db
      .from("stripe_prices")
      .select("stripe_price_id")
      .eq("stripe_mode", mode)
      .eq("plan_id", planId)
      .eq("billing_cycle", billingCycle)
      .eq("is_current", true)
      .maybeSingle();

    if (!price?.stripe_price_id) {
      console.error("[stripe/checkout] No current price for plan", planId, billingCycle, mode);
      return NextResponse.json({ error: "price_not_found" }, { status: 404 });
    }

    const { data: subscription } = await db
      .from("subscriptions")
      .select("id, stripe_customer_id, stripe_subscription_id, stripe_status, stripe_mode")
      .eq("company_id", companyId)
      .maybeSingle();

    // An existing live subscription must change plan through the plan-change
    // endpoint (which prorates correctly), not by buying a second one.
    if (
      subscription?.stripe_subscription_id &&
      subscription.stripe_mode === mode &&
      ["active", "trialing", "past_due"].includes(subscription.stripe_status ?? "")
    ) {
      return NextResponse.json({ error: "already_subscribed" }, { status: 400 });
    }

    const stripe = getStripe(mode);

    // Reuse the Stripe customer only if it came from THIS mode — a test-mode
    // customer id does not exist in live mode and would fail.
    let customerId =
      subscription?.stripe_mode === mode ? subscription?.stripe_customer_id ?? null : null;

    if (!customerId) {
      const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: name || undefined,
        // company_id is the join key the webhook falls back to when the customer
        // id has not been stored yet.
        metadata: { company_id: companyId, user_id: user.id },
      });
      customerId = customer.id;

      await db
        .from("subscriptions")
        .update({
          stripe_customer_id: customerId,
          stripe_mode: mode,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);
    }

    const baseUrl = getAppUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.stripe_price_id, quantity: 1 }],
      // Carried on both the session and the subscription so the webhook can
      // resolve the company from either object.
      metadata: { company_id: companyId, plan_id: planId },
      /**
       * NO trial_period_days.
       *
       * The trial runs locally from the moment someone registers (migration 023),
       * so by the time they reach checkout they have already had it. Adding a
       * Stripe trial here would hand them a second free period on top.
       *
       * Checkout is therefore always an UPGRADE: payment starts immediately.
       */
      subscription_data: {
        metadata: { company_id: companyId, plan_id: planId },
      },
      // ?checkout=success is a UI hint ONLY. Entitlement is read from the
      // database, which the webhook writes, so forging this URL grants nothing.
      success_url: `${baseUrl}/settings?checkout=success`,
      cancel_url: `${baseUrl}/settings?checkout=cancelled`,
      allow_promotion_codes: true,
      // Stripe collects and remits VAT/sales tax where required. Cheaper to
      // enable now than to retrofit after selling cross-border.
      automatic_tax: { enabled: true },
      billing_address_collection: "auto",
    });

    if (!session.url) {
      console.error("[stripe/checkout] Session created without a URL");
      return NextResponse.json({ error: "Could not start checkout" }, { status: 500 });
    }

    console.log("[stripe/checkout] Session", session.id, "for company", companyId);
    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    /**
     * "No such price" means our stored price id points at something that no
     * longer exists in Stripe — deleted in the dashboard, or created under a
     * different account. Raw Stripe wording is meaningless to a customer and
     * gives an operator no next step, so translate it into the actual fix.
     */
    if (code === "resource_missing" || /No such price/i.test(message)) {
      console.error(
        "[stripe/checkout] Stored price is stale — re-run the price sync in " +
        "Admin > Subscriptions > Billing & Stripe. Stripe said:", message
      );
      return NextResponse.json(
        {
          error: "price_stale",
          message:
            "This plan is not set up correctly in Stripe yet. Please contact support.",
        },
        { status: 503 }
      );
    }

    console.error("[stripe/checkout] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}


