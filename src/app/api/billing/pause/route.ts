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
import {
  canCancel,
  isCancelReason,
  formatAccessDate,
  offerFor,
} from "@/lib/billing/cancellation";
import { recordCancellationFeedback } from "@/lib/billing/cancellation-record";
import {
  canPauseSelf,
  isPauseMonths,
  pauseScheduleFor,
} from "@/lib/billing/pause";
import { logActivity } from "@/lib/activity-log";
import { sendBillingPausedEmail } from "@/lib/mailgun";
import { getAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST /api/billing/pause
 *
 * The "take a break" offer: stops billing for one to three months instead of
 * cancelling.
 *
 * WHAT A PAUSE DOES, decided deliberately and stated on the screen: billing
 * stops, ACCESS STOPS, nothing is deleted. It reuses the same `is_paused` gate
 * an admin suspension uses, because stopping the money while leaving the
 * product open would be giving it away.
 *
 * HOW STRIPE PAUSING ACTUALLY WORKS — the same trap documented on the admin
 * route, repeated because it drives the write order here. Stripe has no
 * "paused" status for a normal subscriber: `pause_collection` stops invoicing
 * but leaves `subscription.status` as 'active'. So the local flag is the source
 * of truth and Stripe is told to stop collecting as a consequence.
 *
 * `behavior: 'void'` so no invoice accrues for the paused months. The customer
 * has no access during the pause, so billing them later for the gap would be
 * charging for nothing.
 *
 * STRIPE FIRST, THEN THE LOCAL FLAG, and a Stripe failure ABORTS — the opposite
 * of the admin route's choice, on purpose. An admin suspending an abusive
 * account needs the lockout to take effect even if Stripe is unreachable. A
 * customer pausing to save money gains nothing from being locked out of a
 * product that is still charging them, so if collection cannot be stopped the
 * pause does not happen and they are told.
 *
 * Body: { reason: CancelReason, reasonDetail?: string, months: 1 | 2 | 3 }
 *
 * Responses:
 *   200 { paused: true, resumesAt, pausesAt }
 *   400 { error: "invalid_reason" | "invalid_months" }
 *   401 { error: "Unauthorized" }
 *   403 { error: "billing_disabled" | "not_permitted" }
 *   409 { error: "cannot_pause", blocker }
 *   502 { error: "stripe_failed", message }
 *   503 { error: "stripe_not_configured" }
 */

const MAX_DETAIL_CHARS = 2000;

interface SubRow {
  id: string;
  plan_id: string | null;
  status: string;
  stripe_status: string | null;
  stripe_subscription_id: string | null;
  stripe_mode: string | null;
  billing_cycle: string;
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

    let body: {
      reason?: unknown; reasonDetail?: unknown; months?: unknown;
    } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }

    if (!isCancelReason(body.reason)) {
      return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
    }
    // Only 1, 2 or 3. An arbitrary number here would be a free suspension of
    // whatever length the caller fancied.
    if (!isPauseMonths(body.months)) {
      return NextResponse.json({ error: "invalid_months" }, { status: 400 });
    }

    const reason = body.reason;
    const months = body.months;
    const reasonDetail =
      typeof body.reasonDetail === "string" && body.reasonDetail.trim()
        ? body.reasonDetail.trim().slice(0, MAX_DETAIL_CHARS)
        : null;

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

    // Owner-only: pausing suspends the whole company's access.
    if (!me?.company_id || (me.role && me.role !== "owner")) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    const companyId = me.company_id;

    const { data: subRaw } = await db
      .from("subscriptions")
      .select(
        "id, plan_id, status, stripe_status, stripe_subscription_id, stripe_mode, " +
        "billing_cycle, current_period_end, cancel_at_period_end, is_comped, is_paused"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const sub = subRaw as SubRow | null;
    const resolvedStatus = sub ? (sub.stripe_status ?? sub.status) : null;
    const hasStripeSubscription =
      !!sub?.stripe_subscription_id && sub.stripe_mode === STRIPE_MODE_TAG;

    /**
     * Reuses canCancel, so pause and cancel cannot disagree about who is in a
     * normal paying state: it already refuses a comp (nothing to pause), a
     * trial (no Stripe subscription to stop collecting on), an already-paused
     * account and one that is already ending.
     */
    const cancelEligibility = canCancel(
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

    const eligibility = canPauseSelf({
      cancelEligible: cancelEligibility.allowed,
      billingCycle: sub?.billing_cycle ?? null,
    });

    if (!eligibility.allowed) {
      console.warn(
        "[billing/pause] Refused for company", companyId,
        "| blocker:", eligibility.blocker,
        "| cycle:", sub?.billing_cycle ?? "none",
        "| cancelEligible:", cancelEligibility.allowed,
        cancelEligibility.allowed ? "" : `(${(cancelEligibility as { blocker: string }).blocker})`
      );
      return NextResponse.json(
        { error: "cannot_pause", blocker: eligibility.blocker },
        { status: 409 }
      );
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    const subscriptionId = sub!.stripe_subscription_id!;
    const schedule = pauseScheduleFor(months);

    /**
     * STRIPE FIRST, AND A FAILURE ABORTS.
     *
     * If collection cannot be stopped there is nothing to gain from locking the
     * customer out — they would be paying full price for a product they can no
     * longer open, which is worse than the cancellation they were considering.
     * So unlike the admin route, this does not write the local flag on failure.
     */
    try {
      await getStripe().subscriptions.update(subscriptionId, {
        pause_collection: {
          behavior: "void",
          resumes_at: Math.floor(new Date(schedule.resumesAt).getTime() / 1000),
        },
      });
    } catch (err) {
      const message = errMessage(err);
      console.error("[billing/pause] Stripe pause failed:", message);
      return NextResponse.json({ error: "stripe_failed", message }, { status: 502 });
    }

    const { error: patchError } = await db
      .from("subscriptions")
      .update({
        is_paused: true,
        paused_at: schedule.pausesAt,
        // The acting USER, matching how the admin route records its actor.
        paused_by: user.id,
        /**
         * Visible only to admins. Says plainly that the customer did this, so
         * nobody reading the admin table mistakes a self-imposed break for a
         * suspension someone applied.
         */
        pause_reason: `Paused by the customer for ${months} month${months === 1 ? "" : "s"} from the cancellation flow`,
        pause_resumes_at: schedule.resumesAt,
        // THE FIELD THAT MAKES THIS SELF-REVERSIBLE. Without it the resume
        // route would refuse, treating this as an admin suspension.
        pause_origin: "customer",
        // A fresh pause has not been warned about yet.
        pause_reminder_sent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);

    if (patchError) {
      /**
       * Stripe has stopped collecting but the gate is not set, so the customer
       * keeps access while not paying. Reported as a failure AND the Stripe
       * pause is rolled back, because the alternative is silently giving the
       * product away.
       */
      console.error("[billing/pause] Local patch failed, rolling back Stripe:", patchError.message);
      try {
        await getStripe().subscriptions.update(subscriptionId, { pause_collection: null });
      } catch (rollbackErr) {
        console.error(
          "[billing/pause] ROLLBACK FAILED for company", companyId,
          "— collection is stopped with no local pause:", errMessage(rollbackErr)
        );
      }
      return NextResponse.json({ error: patchError.message }, { status: 500 });
    }

    // One row for the journey, as the cancel route does. The pause screen is a
    // save-offer, so this counts as the offer having worked.
    await recordCancellationFeedback(db, {
      companyId,
      userId: user.id,
      userEmail: me.email,
      reason,
      reasonDetail,
      outcome: "offer_accepted",
      offerShown: offerFor(reason),
      offerOutcome: "accepted",
      details: { pausedMonths: months, resumesAt: schedule.resumesAt },
      planId: sub!.plan_id,
      stripeSubscriptionId: subscriptionId,
      accessEndsAt: sub!.current_period_end,
    });

    if (me.email) {
      const { data: plan } = sub!.plan_id
        ? await db
            .from("subscription_plans")
            .select("name")
            .eq("id", sub!.plan_id)
            .maybeSingle()
        : { data: null };

      const sent = await sendBillingPausedEmail(me.email, {
        firstName: me.first_name,
        planName: (plan as { name?: string } | null)?.name ?? null,
        months,
        restartsOn: formatAccessDate(schedule.resumesAt),
        resumeUrl: `${getAppUrl()}/account-paused`,
      });
      if (!sent) {
        console.error("[billing/pause] Confirmation email not sent to", me.email);
      }
    }

    await logActivity({
      companyId,
      actorUserId: user.id,
      actorEmail: me.email,
      action: "billing.paused",
      targetType: "subscription",
      targetId: sub!.id,
      metadata: {
        origin: "customer",
        reason,
        months,
        resumesAt: schedule.resumesAt,
        stripeSubscriptionId: subscriptionId,
      },
    });

    console.log(
      "[billing/pause] company", companyId,
      "| months:", months,
      "| resumes:", schedule.resumesAt
    );

    return NextResponse.json({
      paused: true,
      pausesAt: schedule.pausesAt,
      resumesAt: schedule.resumesAt,
    });
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[billing/pause] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
