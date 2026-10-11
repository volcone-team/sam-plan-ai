import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe-client";

export const runtime = "nodejs";

/**
 * POST /api/admin/subscribers/pause — suspend or resume an account.
 *
 * Body: { action: 'pause',  companyId, reason?, resumesAt?: string|null }
 *       { action: 'resume', companyId }
 *
 * HOW STRIPE PAUSING ACTUALLY WORKS, because it is not obvious:
 *
 * Stripe has no "paused" subscription status for a normal subscriber. Setting
 * `pause_collection` stops invoicing but leaves `subscription.status` as
 * 'active' — the 'paused' status only ever applies to a paused TRIAL. So the
 * local `is_paused` column is the source of truth, and Stripe is told to stop
 * collecting as a consequence. Reading the pause back off Stripe's status would
 * always report 'active', and the webhook sync would overwrite any guess.
 *
 * `behavior: 'void'` is used rather than 'keep_as_draft' or 'mark_uncollectible'
 * so no invoice accrues while paused. The customer is not using the product, so
 * billing them later for the gap would be wrong.
 *
 * NO STRIPE SUBSCRIPTION IS FINE. Comped accounts, trials and admin-created
 * accounts have none, and they must still be pausable — a Stripe-only mechanism
 * could not lock them out. The local flag does the gating; the Stripe call is
 * best-effort on top.
 *
 * Responses:
 *   200 { paused | resumed, stripeSynced, stripeError? }
 *   400 { error } — malformed body
 *   401/403 — not a super admin
 *   404 { error } — no subscription for that company
 */

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: {
      action?: unknown;
      companyId?: unknown;
      reason?: unknown;
      resumesAt?: unknown;
    } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "Malformed body" }, { status: 400 });
    }

    if (typeof body.companyId !== "string" || !body.companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    if (body.action !== "pause" && body.action !== "resume") {
      return NextResponse.json(
        { error: "action must be 'pause' or 'resume'" },
        { status: 400 }
      );
    }

    const companyId = body.companyId;
    const db = adminClient();
    const now = new Date().toISOString();

    const { data: existing } = await db
      .from("subscriptions")
      .select("id, stripe_subscription_id, stripe_status, is_paused")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: "That company has no subscription to pause." },
        { status: 404 }
      );
    }

    const sub = existing as {
      id: string;
      stripe_subscription_id: string | null;
      stripe_status: string | null;
      is_paused: boolean | null;
    };

    /**
     * An optional auto-resume date. Validated here rather than trusted: it is
     * sent to Stripe as a unix timestamp, and a malformed value would either
     * throw there or silently resume at the epoch.
     */
    let resumesAt: string | null = null;
    if (body.action === "pause" && typeof body.resumesAt === "string" && body.resumesAt.trim()) {
      const t = new Date(body.resumesAt).getTime();
      if (!Number.isFinite(t)) {
        return NextResponse.json({ error: "resumesAt is not a valid date" }, { status: 400 });
      }
      if (t <= Date.now()) {
        return NextResponse.json(
          { error: "The resume date must be in the future." },
          { status: 400 }
        );
      }
      resumesAt = new Date(t).toISOString();
    }

    /**
     * STRIPE FIRST, then the local flag — but a Stripe failure does NOT block
     * the pause.
     *
     * The local flag is what gates access, so it must be written even if Stripe
     * is unreachable: an admin suspending an abusive account needs that to take
     * effect now. The response reports `stripeSynced` so the admin knows
     * whether invoicing was actually stopped, rather than assuming it was.
     */
    let stripeSynced = false;
    let stripeError: string | null = null;

    if (sub.stripe_subscription_id && isStripeConfigured()) {
      try {
        const stripe = getStripe();
        if (body.action === "pause") {
          await stripe.subscriptions.update(sub.stripe_subscription_id, {
            pause_collection: {
              // void: no invoice accrues for the paused period. The customer is
              // not using the product, so billing for the gap later is wrong.
              behavior: "void",
              ...(resumesAt
                ? { resumes_at: Math.floor(new Date(resumesAt).getTime() / 1000) }
                : {}),
            },
          });
        } else {
          // Explicit null clears the pause and resumes normal collection.
          await stripe.subscriptions.update(sub.stripe_subscription_id, {
            pause_collection: null,
          });
        }
        stripeSynced = true;
      } catch (err) {
        stripeError = errMessage(err);
        console.error("[admin/pause] Stripe update failed:", stripeError);
      }
    }

    const patch =
      body.action === "pause"
        ? {
            is_paused: true,
            paused_at: now,
            paused_by: check.userId,
            pause_reason:
              typeof body.reason === "string" && body.reason.trim()
                ? body.reason.trim().slice(0, 300)
                : "Paused by super admin",
            pause_resumes_at: resumesAt,
            updated_at: now,
          }
        : {
            is_paused: false,
            paused_at: null,
            paused_by: null,
            pause_reason: null,
            pause_resumes_at: null,
            updated_at: now,
          };

    const { error } = await db
      .from("subscriptions")
      .update(patch)
      .eq("company_id", companyId);

    if (error) {
      console.error("[admin/pause] Update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity({
      companyId,
      actorUserId: check.userId,
      actorEmail: (actor as { email?: string } | null)?.email ?? null,
      action: body.action === "pause" ? "billing.paused" : "billing.resumed",
      targetType: "subscription",
      targetId: sub.id,
      metadata: {
        reason: body.action === "pause" ? patch.pause_reason : null,
        resumesAt,
        stripeSynced,
        stripeError,
      },
    });

    console.log(
      "[admin/pause]", body.action, "company", companyId,
      "| stripe synced:", stripeSynced
    );

    return NextResponse.json({
      [body.action === "pause" ? "paused" : "resumed"]: true,
      stripeSynced,
      // Surfaced so the admin is told when billing did not actually stop.
      stripeError,
      hasStripeSubscription: !!sub.stripe_subscription_id,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/pause] Error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
