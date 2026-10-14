import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getStripe,
  isStripeConfigured,
  loadBillingConfig,
  STRIPE_MODE_TAG,
} from "@/lib/billing/stripe-client";
import { canReactivate, formatAccessDate } from "@/lib/billing/cancellation";
import { logActivity } from "@/lib/activity-log";
import { sendSubscriptionReactivatedEmail } from "@/lib/mailgun";
import { getAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST /api/billing/reactivate
 *
 * Undoes a pending cancellation: clears `cancel_at_period_end` so the
 * subscription renews as it would have.
 *
 * "Reactivate my plan" IS TWO OPERATIONS BEHIND ONE LABEL, and conflating them
 * is how you end up calling update() on a dead subscription:
 *
 *   resume     — still inside the paid period, Stripe status still 'active'.
 *                Handled here. No money moves, nothing is prorated; the next
 *                invoice simply happens on schedule.
 *   repurchase — the period has lapsed and Stripe has cancelled for real. A
 *                cancelled subscription is largely immutable, so there is
 *                nothing to update. This route reports
 *                `{ requiresCheckout: true }` and the client sends them to
 *                /api/stripe/checkout rather than this route reimplementing it.
 *
 * canReactivate (unit tested) decides which case applies.
 *
 * Reachable while locked out, which is the point: a customer whose period has
 * lapsed is locked out BY DEFINITION, and lockout.ts allows the whole
 * `/api/billing` prefix. Putting this under /api/stripe would have made the
 * only route that can let them back in unreachable from the state they are in.
 *
 * Responses:
 *   200 { reactivated: true, renewsOn }
 *   200 { reactivated: false, requiresCheckout: true }
 *   401 { error: "Unauthorized" }
 *   403 { error: "billing_disabled" | "not_permitted" }
 *   409 { error: "cannot_reactivate", blocker }
 *   502 { error: "stripe_failed", message }
 *   503 { error: "stripe_not_configured" }
 */

interface SubRow {
  id: string;
  plan_id: string | null;
  status: string;
  stripe_status: string | null;
  stripe_subscription_id: string | null;
  stripe_mode: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  is_comped: boolean;
  is_paused: boolean | null;
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

    const db = serviceClient();

    const config = await loadBillingConfig(db);
    if (!config.stripeEnabled) {
      return NextResponse.json({ error: "billing_disabled" }, { status: 403 });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role, email, first_name")
      .eq("id", user.id)
      .maybeSingle();

    const me = profile as {
      company_id: string | null; role: string | null;
      email: string | null; first_name: string | null;
    } | null;

    // Owner-only, matching cancel and the portal: reactivating commits the
    // company to a renewal charge.
    if (!me?.company_id || (me.role && me.role !== "owner")) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    const companyId = me.company_id;

    const { data: subRaw } = await db
      .from("subscriptions")
      .select(
        "id, plan_id, status, stripe_status, stripe_subscription_id, stripe_mode, " +
        "current_period_end, cancel_at_period_end, is_comped, is_paused"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const sub = subRaw as SubRow | null;
    const resolvedStatus = sub ? (sub.stripe_status ?? sub.status) : null;
    const hasStripeSubscription =
      !!sub?.stripe_subscription_id && sub.stripe_mode === STRIPE_MODE_TAG;

    const eligibility = canReactivate(
      sub
        ? {
            status: resolvedStatus,
            isComped: sub.is_comped,
            isPaused: sub.is_paused ?? false,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            hasStripeSubscription,
            currentPeriodEnd: sub.current_period_end,
          }
        : null
    );

    if (!eligibility.allowed) {
      return NextResponse.json(
        { error: "cannot_reactivate", blocker: eligibility.blocker },
        { status: 409 }
      );
    }

    /**
     * Period already lapsed. Nothing to update — hand the client to Checkout.
     *
     * Reported as a 200 rather than an error because the customer's intent is
     * perfectly valid and achievable; it just takes a different route.
     */
    if (eligibility.kind === "repurchase") {
      return NextResponse.json({
        reactivated: false,
        requiresCheckout: true,
        planId: sub!.plan_id,
      });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    const subscriptionId = sub!.stripe_subscription_id!;

    let updated;
    try {
      /**
       * Clearing the flag is all that is needed — Stripe recomputes the renewal
       * and clears `canceled_at` itself. `cancellation_details` is deliberately
       * left alone: it is a historical record of what they told us, and the
       * next cancellation overwrites it anyway.
       */
      updated = await getStripe().subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
    } catch (err) {
      const message = errMessage(err);
      console.error("[billing/reactivate] Stripe update failed:", message);
      return NextResponse.json({ error: "stripe_failed", message }, { status: 502 });
    }

    /**
     * Mirror locally, matching syncSubscription's fields so the webhook's later
     * write agrees rather than corrects. `renewal_date` comes back because the
     * subscription renews again — it is what makes the panel say "Renews"
     * instead of "Ends".
     */
    const periodEnd = sub!.current_period_end;
    const { error: patchError } = await db
      .from("subscriptions")
      .update({
        cancel_at_period_end: false,
        renewal_date: periodEnd,
        cancelled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);

    if (patchError) {
      console.error("[billing/reactivate] Local patch failed:", patchError.message);
    }

    if (me.email) {
      const { data: plan } = sub!.plan_id
        ? await db
            .from("subscription_plans")
            .select("name")
            .eq("id", sub!.plan_id)
            .maybeSingle()
        : { data: null };

      const sent = await sendSubscriptionReactivatedEmail(me.email, {
        firstName: me.first_name,
        planName: (plan as { name?: string } | null)?.name ?? null,
        renewsOn: formatAccessDate(periodEnd),
        settingsUrl: `${getAppUrl()}/settings`,
      });
      if (!sent) {
        console.error("[billing/reactivate] Confirmation email not sent to", me.email);
      }
    }

    await logActivity({
      companyId,
      actorUserId: user.id,
      actorEmail: me.email,
      action: "billing.reactivated",
      targetType: "subscription",
      targetId: sub!.id,
      metadata: {
        renewsOn: periodEnd,
        stripeSubscriptionId: subscriptionId,
        stripeStatus: updated.status,
      },
    });

    console.log(
      "[billing/reactivate] company", companyId,
      "| renews:", periodEnd ?? "unknown"
    );

    return NextResponse.json({ reactivated: true, renewsOn: periodEnd });
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[billing/reactivate] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
