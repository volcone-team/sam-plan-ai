import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import {
  isModeConfigured,
  detectKeyMismatch,
  loadBillingConfig,
  type StripeMode,
} from "@/lib/billing/stripe-client";
import { syncPlansToStripe, migrateSubscribersToCurrentPrice } from "@/lib/billing/sync-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Price sync makes several sequential Stripe calls.
export const maxDuration = 60;

/**
 * Billing administration. SUPER-ADMIN ONLY — these actions decide whether
 * customers are charged, how much, and in which Stripe universe, so plain admins
 * are excluded deliberately.
 *
 * GET  → current settings, key configuration status, prices, plans.
 * PUT  → update settings (enable, mode, trial, dunning).
 * POST → actions: sync_prices | migrate_price
 *
 * Reports which modes have keys WITHOUT ever returning a key value, so the UI
 * can explain "live mode has no key" rather than failing mysteriously later.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();
    const config = await loadBillingConfig(db);

    const { data: plans } = await db
      .from("subscription_plans")
      .select("id, name, tagline, monthly_price, annual_price, is_active, is_default, display_order")
      .order("display_order");

    const { data: prices } = await db
      .from("stripe_prices")
      .select("plan_id, stripe_mode, billing_cycle, stripe_price_id, unit_amount, is_current, created_at")
      .order("created_at", { ascending: false });

    // Subscriber counts by state, so the mode toggle can warn before switching.
    const { count: liveSubCount } = await db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .not("stripe_subscription_id", "is", null);

    const { count: compedCount } = await db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("is_comped", true);

    return NextResponse.json({
      settings: {
        stripeEnabled: config.stripeEnabled,
        stripeMode: config.mode,
        trialEnabled: config.trialEnabled,
        trialDays: config.trialDays,
        trialPlanId: config.trialPlanId,
        trialRequiresCard: config.trialRequiresCard,
        dunningGraceDays: config.dunningGraceDays,
      },
      // Never the keys themselves — only whether each mode is usable.
      keys: {
        testConfigured: isModeConfigured("test"),
        liveConfigured: isModeConfigured("live"),
        testWarning: detectKeyMismatch("test"),
        liveWarning: detectKeyMismatch("live"),
      },
      plans: plans ?? [],
      prices: prices ?? [],
      counts: {
        stripeSubscriptions: liveSubCount ?? 0,
        comped: compedCount ?? 0,
      },
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/billing] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const db = adminClient();
    const patch: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};

    if (body.stripeEnabled !== undefined) {
      if (typeof body.stripeEnabled !== "boolean") {
        return NextResponse.json({ error: "stripeEnabled" }, { status: 400 });
      }
      // Refuse to enable billing with no usable key: customers would hit a
      // paywall that cannot take payment, locking them out of the product.
      if (body.stripeEnabled) {
        const config = await loadBillingConfig(db);
        const targetMode: StripeMode =
          (body.stripeMode as StripeMode) === "live" ||
          (body.stripeMode === undefined && config.mode === "live")
            ? "live"
            : "test";
        if (!isModeConfigured(targetMode)) {
          return NextResponse.json(
            { error: "key_missing", mode: targetMode },
            { status: 400 }
          );
        }
      }
      patch.stripe_enabled = body.stripeEnabled;
      changed.stripeEnabled = body.stripeEnabled;
    }

    if (body.stripeMode !== undefined) {
      if (body.stripeMode !== "test" && body.stripeMode !== "live") {
        return NextResponse.json({ error: "stripeMode" }, { status: 400 });
      }
      if (!isModeConfigured(body.stripeMode)) {
        return NextResponse.json(
          { error: "key_missing", mode: body.stripeMode },
          { status: 400 }
        );
      }
      patch.stripe_mode = body.stripeMode;
      changed.stripeMode = body.stripeMode;
    }

    if (body.trialEnabled !== undefined) {
      if (typeof body.trialEnabled !== "boolean") {
        return NextResponse.json({ error: "trialEnabled" }, { status: 400 });
      }
      patch.trial_enabled = body.trialEnabled;
      changed.trialEnabled = body.trialEnabled;
    }

    if (body.trialDays !== undefined) {
      const days = Number(body.trialDays);
      if (!Number.isFinite(days) || days < 0 || days > 365) {
        return NextResponse.json({ error: "trialDays" }, { status: 400 });
      }
      patch.trial_days = Math.floor(days);
      changed.trialDays = Math.floor(days);
    }

    if (body.trialPlanId !== undefined) {
      if (body.trialPlanId === null) {
        patch.trial_plan_id = null;
        changed.trialPlanId = null;
      } else if (typeof body.trialPlanId === "string") {
        patch.trial_plan_id = body.trialPlanId;
        changed.trialPlanId = body.trialPlanId;
      } else {
        return NextResponse.json({ error: "trialPlanId" }, { status: 400 });
      }
    }

    if (body.trialRequiresCard !== undefined) {
      if (typeof body.trialRequiresCard !== "boolean") {
        return NextResponse.json({ error: "trialRequiresCard" }, { status: 400 });
      }
      patch.trial_requires_card = body.trialRequiresCard;
      changed.trialRequiresCard = body.trialRequiresCard;
    }

    if (body.dunningGraceDays !== undefined) {
      const days = Number(body.dunningGraceDays);
      if (!Number.isFinite(days) || days < 0 || days > 90) {
        return NextResponse.json({ error: "dunningGraceDays" }, { status: 400 });
      }
      patch.dunning_grace_days = Math.floor(days);
      changed.dunningGraceDays = Math.floor(days);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
    }

    const { error } = await db
      .from("app_settings")
      .upsert(
        { id: "global", ...patch, updated_by: check.userId, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );

    if (error) {
      console.error("[admin/billing] Settings write failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: actor } = await db
      .from("profiles").select("email").eq("id", check.userId).maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: actor?.email ?? null,
        action: "billing_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "billing",
        metadata: { changed, fields: Object.keys(changed) },
      },
      db
    );

    return NextResponse.json({ updated: true, changed });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/billing] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: { action?: unknown; planId?: unknown; mode?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const db = adminClient();
    const config = await loadBillingConfig(db);
    const mode: StripeMode =
      body.mode === "live" || body.mode === "test" ? body.mode : config.mode;

    if (!isModeConfigured(mode)) {
      return NextResponse.json({ error: "key_missing", mode }, { status: 400 });
    }

    const { data: actor } = await db
      .from("profiles").select("email").eq("id", check.userId).maybeSingle();

    if (body.action === "sync_prices") {
      const result = await syncPlansToStripe(db, mode);

      await logActivity(
        {
          actorUserId: check.userId,
          actorEmail: actor?.email ?? null,
          action: "billing.prices_synced",
          targetType: "stripe_prices",
          targetId: null,
          targetLabel: mode,
          metadata: {
            created: result.created.length,
            updated: result.updated.length,
            errors: result.errors.length,
          },
        },
        db
      );

      return NextResponse.json(result);
    }

    if (body.action === "migrate_price") {
      if (typeof body.planId !== "string" || !body.planId) {
        return NextResponse.json({ error: "planId" }, { status: 400 });
      }

      // Changes what real customers are charged, so it is audited as its own
      // action rather than being a side effect of syncing.
      const result = await migrateSubscribersToCurrentPrice(db, mode, body.planId);

      await logActivity(
        {
          actorUserId: check.userId,
          actorEmail: actor?.email ?? null,
          action: "billing.subscribers_migrated",
          targetType: "subscription_plans",
          targetId: body.planId,
          targetLabel: mode,
          metadata: result,
        },
        db
      );

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/billing] POST error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
