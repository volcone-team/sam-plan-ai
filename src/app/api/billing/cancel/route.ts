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
  stripeFeedbackFor,
  formatAccessDate,
  offerFor,
  sanitiseOfferDetails,
  namedAnotherTool,
  offerOutcomeFor,
} from "@/lib/billing/cancellation";
import { recordCancellationFeedback } from "@/lib/billing/cancellation-record";
import { logActivity } from "@/lib/activity-log";
import { sendSubscriptionCancelledEmail } from "@/lib/mailgun";
import { getAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";

/**
 * POST /api/billing/cancel
 *
 * The end of the cancellation flow, and the only way to cancel from inside the
 * app. Cancels AT PERIOD END — never immediately — because the customer has
 * already paid for the current period and cutting access early takes away
 * purchased value. `cancelSubscriptionsForCompany` is the immediate-cancel
 * path and exists for a different situation: account deletion, where there is
 * nothing left to deliver.
 *
 * WHY THIS IS UNDER /api/billing AND NOT /api/stripe. Both prefixes reach the
 * same Stripe account, but lockout.ts allows the whole `/api/billing` prefix
 * while a customer is locked out and allows only checkout and portal under
 * `/api/stripe`. Reactivation has to work from a locked-out state, and keeping
 * the pair together means neither drifts onto the wrong side of that list.
 *
 * RECORDS CUSTOMERS WHO STAY, TOO. `outcome: "kept"` writes a feedback row and
 * touches nothing else. Without it an offer nobody accepts is indistinguishable
 * from an offer nobody is shown, and the retention funnel cannot be measured.
 *
 * WHAT THE CLIENT IS TRUSTED FOR, which is as little as possible. The reason is
 * validated against the catalogue; the offer screen and its outcome are DERIVED
 * from that reason plus ENABLED_OFFERS; the free-text payload is pushed through
 * an allow-list. The only unverifiable fact the client supplies is
 * `reachedOffer` — how far through the flow they got — because the server
 * genuinely cannot see it.
 *
 * Body:
 *   {
 *     reason: CancelReason,
 *     reasonDetail?: string,
 *     outcome: "cancelled" | "kept",
 *     reachedOffer?: boolean,
 *     offerDetails?: object        // shape depends on the screen; allow-listed
 *   }
 *
 * Responses:
 *   200 { cancelled: true, accessEndsAt, email, status, balanceOutstanding }
 *   200 { cancelled: false, outcome: "kept" }
 *   400 { error: "invalid_reason" | "invalid_outcome" }
 *   401 { error: "Unauthorized" }
 *   403 { error: "billing_disabled" | "not_permitted" }
 *   409 { error: "cannot_cancel", blocker }   — valid request, wrong state
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
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  is_comped: boolean;
  is_paused: boolean | null;
  pending_plan_id: string | null;
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
      reason?: unknown; reasonDetail?: unknown; outcome?: unknown;
      reachedOffer?: unknown; offerDetails?: unknown;
    } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }

    // Validated against the catalogue in lib/billing/cancellation.ts, which is
    // also why the column has no CHECK constraint — see migration 030.
    if (!isCancelReason(body.reason)) {
      return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
    }
    const reason = body.reason;

    /**
     * REQUIRED, not defaulted.
     *
     * Defaulting a missing outcome to "cancelled" would mean a malformed
     * request cancels a paying customer's subscription. Defaulting it to "kept"
     * would silently swallow a real cancellation. Neither is acceptable for an
     * action this hard to reverse, so an absent value is a 400.
     */
    if (body.outcome !== "cancelled" && body.outcome !== "kept") {
      return NextResponse.json({ error: "invalid_outcome" }, { status: 400 });
    }
    const outcome = body.outcome;

    const reasonDetail =
      typeof body.reasonDetail === "string" && body.reasonDetail.trim()
        ? body.reasonDetail.trim().slice(0, MAX_DETAIL_CHARS)
        : null;

    /**
     * The step-2 screen, resolved from the reason rather than taken on trust.
     *
     * `offerFor` returns null when that screen is not built, so a client
     * claiming to have seen the discount offer before it exists records
     * nothing. `reachedOffer` is the one thing only the client knows, and the
     * worst a false value can do is mislabel one analytics row — it grants no
     * access and changes no billing.
     */
    const reachedOffer = body.reachedOffer === true;
    const offerShown = reachedOffer ? offerFor(reason) : null;

    // Allow-listed per screen; anything the screen does not collect is dropped.
    const offerDetails = sanitiseOfferDetails(offerShown, body.offerDetails);

    const offerOutcome = offerOutcomeFor({
      reachedOffer: !!offerShown,
      outcome,
    });

    /**
     * What to put in Stripe's one free-text field.
     *
     * The feedback screen's "what's missing" answer wins over step 1's generic
     * "anything else", because it was given in response to a specific question
     * and is the more useful of the two. Only one can be sent — Stripe's
     * `cancellation_details.comment` is a single string — and both are kept in
     * full on our own row regardless.
     */
    const missingAnswer =
      typeof offerDetails.missing === "string" ? offerDetails.missing : null;
    const stripeComment = missingAnswer ?? reasonDetail;

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

    /**
     * Owner-only, matching /api/stripe/portal and /api/stripe/change-plan. A
     * team member being able to close the company's account is a strictly worse
     * version of the problem the portal route already guards against.
     */
    if (!me?.company_id || (me.role && me.role !== "owner")) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    const companyId = me.company_id;

    const { data: subRaw } = await db
      .from("subscriptions")
      .select(
        "id, plan_id, status, stripe_status, stripe_subscription_id, stripe_mode, " +
        "current_period_end, cancel_at_period_end, is_comped, is_paused, pending_plan_id"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const sub = subRaw as SubRow | null;
    const resolvedStatus = sub ? (sub.stripe_status ?? sub.status) : null;
    const hasStripeSubscription =
      !!sub?.stripe_subscription_id && sub.stripe_mode === STRIPE_MODE_TAG;

    /**
     * "Keep my plan" — record and stop.
     *
     * Deliberately BEFORE the eligibility guards. Someone whose account turns
     * out to be comped or already ending still told us why they were thinking
     * of leaving, and refusing to store that because they cannot cancel would
     * discard the most useful half of the signal.
     */
    if (outcome === "kept") {
      await recordCancellationFeedback(db, {
        companyId,
        userId: user.id,
        userEmail: me.email,
        reason,
        reasonDetail,
        outcome: "kept",
        planId: sub?.plan_id ?? null,
        stripeSubscriptionId: sub?.stripe_subscription_id ?? null,
        accessEndsAt: sub?.current_period_end ?? null,
        offerShown,
        offerOutcome,
        details: offerDetails,
      });
      return NextResponse.json({ cancelled: false, outcome: "kept" });
    }

    const eligibility = canCancel(
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
      // 409 rather than 400: the request is well formed, the account state is
      // what forbids it. The client maps `blocker` through explainBlocker.
      return NextResponse.json(
        { error: "cannot_cancel", blocker: eligibility.blocker },
        { status: 409 }
      );
    }

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
    }

    const stripe = getStripe();
    const subscriptionId = sub!.stripe_subscription_id!;

    /**
     * RELEASE ANY PENDING DOWNGRADE SCHEDULE FIRST.
     *
     * This is the same trap change-plan documents for upgrades, and it bites
     * harder here. A scheduled downgrade attaches a subscription schedule whose
     * next phase begins at period end — the exact moment the cancellation is
     * supposed to take effect. Left attached, the schedule starts its phase and
     * the subscription CARRIES ON, on the cheaper plan, billing a customer who
     * believes they cancelled.
     *
     * `release` detaches the schedule and leaves the subscription running, which
     * is what we want: the cancellation below then owns the period end.
     * `cancel` would end the subscription immediately and lose the paid period.
     *
     * Failure is logged and not fatal. The common cause is a schedule Stripe has
     * already released, in which case there was nothing to detach.
     */
    try {
      const current = await stripe.subscriptions.retrieve(subscriptionId);
      if (current.schedule) {
        const scheduleId =
          typeof current.schedule === "string" ? current.schedule : current.schedule.id;
        await stripe.subscriptionSchedules.release(scheduleId);
        console.log("[billing/cancel] Released pending schedule", scheduleId);
      }
    } catch (err) {
      console.error("[billing/cancel] Could not release schedule:", errMessage(err));
    }

    /**
     * The cancellation itself.
     *
     * `cancellation_details` is Stripe's own churn reporting. `feedback` must be
     * a value from their enum — stripeFeedbackFor guarantees that and is unit
     * tested, because an invented value is rejected by the API at the worst
     * possible moment.
     */
    let updated;
    try {
      updated = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        cancellation_details: {
          /**
           * Naming a competitor on the feedback screen reports as
           * 'switched_service' instead of 'missing_features'. In Stripe's own
           * churn reporting that is the difference between "we should build
           * this" and "we lost to someone who already has it", which is the
           * more actionable of the two.
           */
          feedback: stripeFeedbackFor(reason, {
            namedAnotherTool: namedAnotherTool(offerDetails),
          }),
          ...(stripeComment ? { comment: stripeComment.slice(0, 500) } : {}),
        },
      });
    } catch (err) {
      const message = errMessage(err);
      console.error("[billing/cancel] Stripe update failed:", message);
      // Nothing has changed anywhere: safe to report a clean failure and let
      // them retry.
      return NextResponse.json(
        { error: "stripe_failed", message },
        { status: 502 }
      );
    }

    /**
     * Mirror it locally straight away.
     *
     * The webhook is the authoritative writer and will send the same values, but
     * it can be late and cannot reach localhost at all. Without this the
     * confirmation screen would render from a row that still says "Renews",
     * which reads as a failed cancellation. The fields match syncSubscription
     * exactly so the webhook's later write is a no-op rather than a correction.
     */
    const periodEnd = sub!.current_period_end;
    const patch: Record<string, unknown> = {
      cancel_at_period_end: true,
      // A subscription that stops is not renewing, and a date here renders as
      // "Renews" in the panel.
      renewal_date: null,
      cancelled_at: updated.canceled_at
        ? new Date(updated.canceled_at * 1000).toISOString()
        : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // The schedule is gone, so the downgrade it carried will never land.
    if (sub!.pending_plan_id) {
      patch.pending_plan_id = null;
      patch.pending_billing_cycle = null;
    }

    const { error: patchError } = await db
      .from("subscriptions")
      .update(patch)
      .eq("company_id", companyId);

    if (patchError) {
      // Stripe is the source of truth and has accepted the cancellation, so
      // this is a display problem, not a billing one. The webhook or a
      // reconcile will correct the row.
      console.error("[billing/cancel] Local patch failed:", patchError.message);
    }

    const balanceOutstanding =
      resolvedStatus === "past_due" || resolvedStatus === "unpaid";

    await recordCancellationFeedback(db, {
      companyId,
      userId: user.id,
      userEmail: me.email,
      reason,
      reasonDetail,
      outcome: "cancelled",
      planId: sub!.plan_id,
      stripeSubscriptionId: subscriptionId,
      accessEndsAt: periodEnd,
      offerShown,
      offerOutcome,
      details: offerDetails,
    });

    // Best effort: sendEmail returns null rather than throwing, and a mail
    // outage must not report a completed cancellation as failed.
    if (me.email) {
      const { data: plan } = sub!.plan_id
        ? await db
            .from("subscription_plans")
            .select("name")
            .eq("id", sub!.plan_id)
            .maybeSingle()
        : { data: null };

      const sent = await sendSubscriptionCancelledEmail(me.email, {
        firstName: me.first_name,
        planName: (plan as { name?: string } | null)?.name ?? null,
        accessUntil: formatAccessDate(periodEnd),
        balanceOutstanding,
        settingsUrl: `${getAppUrl()}/settings`,
      });
      if (!sent) {
        console.error("[billing/cancel] Confirmation email not sent to", me.email);
      }
    }

    await logActivity({
      companyId,
      actorUserId: user.id,
      actorEmail: me.email,
      action: "billing.cancelled",
      targetType: "subscription",
      targetId: sub!.id,
      metadata: {
        reason,
        hasDetail: !!reasonDetail,
        accessEndsAt: periodEnd,
        stripeSubscriptionId: subscriptionId,
        releasedPendingDowngrade: !!sub!.pending_plan_id,
        offerShown,
        offerOutcome,
        // Flags only: the audit log is read by admins and should not duplicate
        // the customer's free text, which already lives on the feedback row.
        namedCompetitor: namedAnotherTool(offerDetails),
      },
    });

    console.log(
      "[billing/cancel] company", companyId,
      "| reason:", reason,
      "| access until:", periodEnd ?? "unknown"
    );

    return NextResponse.json({
      cancelled: true,
      accessEndsAt: periodEnd,
      email: me.email,
      status: resolvedStatus,
      balanceOutstanding,
    });
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[billing/cancel] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
