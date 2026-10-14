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
import { canResumeSelf } from "@/lib/billing/pause";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

/**
 * POST /api/billing/resume
 *
 * Lifts a pause the CUSTOMER applied, restoring billing and access at once.
 *
 * REACHABLE WHILE LOCKED OUT, which is the whole point. A paused account is
 * denied by evaluateAccess, so the middleware sends its pages to
 * /account-paused and its APIs a 403 — except the `/api/billing` prefix, which
 * lockout.ts allows. Putting this under `/api/stripe` would have made the one
 * route that can let them back in unreachable from the only state it is needed
 * in.
 *
 * AN ADMIN PAUSE IS NOT RESUMABLE HERE, and that is a security property rather
 * than a nicety. An admin pause is a suspension — non-payment, a contract
 * dispute, abuse — and a customer who could lift it would make the admin
 * control decorative. canResumeSelf decides, keyed on `pause_origin`, and
 * treats an unknown origin as an admin pause so it fails closed.
 *
 * Responses:
 *   200 { resumed: true }
 *   401 { error: "Unauthorized" }
 *   403 { error: "billing_disabled" | "not_permitted" }
 *   409 { error: "cannot_resume", blocker }
 *   502 { error: "stripe_failed", message }
 */

interface SubRow {
  id: string;
  stripe_subscription_id: string | null;
  stripe_mode: string | null;
  current_period_end: string | null;
  is_paused: boolean | null;
  pause_origin: string | null;
  pause_resumes_at: string | null;
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
      .select("company_id, role, email")
      .eq("id", user.id)
      .maybeSingle();

    const me = profile as {
      company_id: string | null; role: string | null; email: string | null;
    } | null;

    // Owner-only: resuming commits the company to being charged again.
    if (!me?.company_id || (me.role && me.role !== "owner")) {
      return NextResponse.json({ error: "not_permitted" }, { status: 403 });
    }
    const companyId = me.company_id;

    const { data: subRaw } = await db
      .from("subscriptions")
      .select(
        "id, stripe_subscription_id, stripe_mode, current_period_end, " +
        "is_paused, pause_origin, pause_resumes_at"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const sub = subRaw as SubRow | null;

    const eligibility = canResumeSelf({
      isPaused: sub?.is_paused ?? false,
      pauseOrigin: sub?.pause_origin ?? null,
    });

    if (!eligibility.allowed) {
      console.warn(
        "[billing/resume] Refused for company", companyId,
        "| blocker:", eligibility.blocker,
        "| origin:", sub?.pause_origin ?? "none"
      );
      return NextResponse.json(
        { error: "cannot_resume", blocker: eligibility.blocker },
        { status: 409 }
      );
    }

    const hasStripeSubscription =
      !!sub!.stripe_subscription_id && sub!.stripe_mode === STRIPE_MODE_TAG;

    /**
     * Tell Stripe to collect again BEFORE clearing the gate.
     *
     * A failure aborts: restoring access while collection stays paused would
     * hand over the product for free, and that is the one outcome here worth
     * refusing the request over. The opposite order is safe for pausing but not
     * for resuming.
     */
    if (hasStripeSubscription) {
      if (!isStripeConfigured()) {
        return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });
      }
      try {
        // Explicit null clears pause_collection and resumes normal collection.
        await getStripe().subscriptions.update(sub!.stripe_subscription_id!, {
          pause_collection: null,
        });
      } catch (err) {
        const message = errMessage(err);
        console.error("[billing/resume] Stripe resume failed:", message);
        return NextResponse.json({ error: "stripe_failed", message }, { status: 502 });
      }
    }

    const { error: patchError } = await db
      .from("subscriptions")
      .update({
        is_paused: false,
        paused_at: null,
        paused_by: null,
        pause_reason: null,
        pause_resumes_at: null,
        pause_origin: null,
        pause_reminder_sent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);

    if (patchError) {
      /**
       * Stripe is collecting again but the gate is still closed, so the
       * customer is paying and locked out — the exact bug this whole phase
       * exists to fix. Reported as a failure so they retry rather than being
       * told it worked. evaluateAccess also releases them once
       * `pause_resumes_at` elapses, which limits the damage.
       */
      console.error("[billing/resume] Local patch failed:", patchError.message);
      return NextResponse.json({ error: patchError.message }, { status: 500 });
    }

    await logActivity({
      companyId,
      actorUserId: user.id,
      actorEmail: me.email,
      action: "billing.resumed",
      targetType: "subscription",
      targetId: sub!.id,
      metadata: {
        origin: "customer",
        // Was this early, or did the pause run its course?
        scheduledResumeAt: sub!.pause_resumes_at,
        resumedEarly:
          !!sub!.pause_resumes_at &&
          new Date(sub!.pause_resumes_at).getTime() > Date.now(),
        stripeSynced: hasStripeSubscription,
      },
    });

    console.log("[billing/resume] company", companyId, "resumed by customer");

    return NextResponse.json({ resumed: true });
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[billing/resume] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
