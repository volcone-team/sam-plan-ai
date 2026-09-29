import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Subscription plan administration, backed by the DATABASE.
 *
 * Replaces subscription-plan.service.ts, which stored plans, limits and features
 * in localStorage ("swap to Supabase later"). That meant editing a price only
 * changed the admin's own browser: the real `subscription_plans` table was never
 * touched, so Stripe price sync and every limit check still saw the seeded
 * values. Prices appeared to save and then silently had no effect anywhere.
 *
 * GET  → plans with their limits and features
 * PUT  → update a plan, one of its limits, or one of its features
 * POST → create a plan
 * DELETE → remove a plan
 *
 * Super-admin only: these values decide what customers are charged and what they
 * are allowed to do.
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
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const db = adminClient();

    const [plansRes, limitsRes, featuresRes, pricesRes] = await Promise.all([
      db
        .from("subscription_plans")
        .select("id, name, description, tagline, monthly_price, annual_price, is_active, is_default, display_order")
        .order("display_order"),
      db.from("plan_limits").select("id, plan_id, limit_key, limit_label, limit_value"),
      db.from("plan_features").select("id, plan_id, feature_key, feature_label, enabled"),
      db.from("stripe_prices").select("plan_id, billing_cycle, unit_amount, stripe_mode, is_current").eq("is_current", true),
    ]);

    if (plansRes.error) {
      console.error("[admin/plans] Query failed:", plansRes.error.message);
      return NextResponse.json({ error: plansRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      plans: plansRes.data ?? [],
      limits: limitsRes.data ?? [],
      features: featuresRes.data ?? [],
      // Lets the UI show when a plan's DB price differs from what is live in
      // Stripe, i.e. a sync is pending.
      stripePrices: pricesRes.data ?? [],
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/plans] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return NextResponse.json({ error: "planId" }, { status: 400 });

    const db = adminClient();
    const now = new Date().toISOString();
    const changed: Record<string, unknown> = {};

    // ---- A single limit -------------------------------------------------
    if (typeof body.limitKey === "string") {
      const value = Number(body.limitValue);
      // -1 unlimited, 0 disabled, >0 capped. Anything below -1 is meaningless.
      if (!Number.isFinite(value) || value < -1) {
        return NextResponse.json({ error: "limitValue" }, { status: 400 });
      }

      const { error } = await db
        .from("plan_limits")
        .upsert(
          {
            plan_id: planId,
            limit_key: body.limitKey,
            limit_label:
              typeof body.limitLabel === "string" && body.limitLabel
                ? body.limitLabel
                : body.limitKey,
            limit_value: Math.floor(value),
          },
          { onConflict: "plan_id,limit_key" }
        );

      if (error) {
        console.error("[admin/plans] Limit upsert failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      changed.limit = { key: body.limitKey, value: Math.floor(value) };
    }

    // ---- A single feature -----------------------------------------------
    else if (typeof body.featureKey === "string") {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled" }, { status: 400 });
      }

      const { error } = await db
        .from("plan_features")
        .upsert(
          {
            plan_id: planId,
            feature_key: body.featureKey,
            feature_label:
              typeof body.featureLabel === "string" && body.featureLabel
                ? body.featureLabel
                : body.featureKey,
            enabled: body.enabled,
          },
          { onConflict: "plan_id,feature_key" }
        );

      if (error) {
        console.error("[admin/plans] Feature upsert failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      changed.feature = { key: body.featureKey, enabled: body.enabled };
    }

    // ---- Plan fields -----------------------------------------------------
    else {
      const patch: Record<string, unknown> = { updated_at: now };

      for (const [field, column] of [
        ["name", "name"],
        ["description", "description"],
        ["tagline", "tagline"],
      ] as const) {
        if (body[field] !== undefined) {
          if (typeof body[field] !== "string") {
            return NextResponse.json({ error: field }, { status: 400 });
          }
          patch[column] = body[field];
          changed[field] = body[field];
        }
      }

      for (const [field, column] of [
        ["monthlyPrice", "monthly_price"],
        ["annualPrice", "annual_price"],
      ] as const) {
        if (body[field] !== undefined) {
          const price = Number(body[field]);
          // 0 is valid and MEANINGFUL: it means this plan is not offered on that
          // billing cycle, so sync skips it rather than creating a zero price.
          if (!Number.isFinite(price) || price < 0) {
            return NextResponse.json({ error: field }, { status: 400 });
          }
          patch[column] = price;
          changed[field] = price;
        }
      }

      if (body.isActive !== undefined) {
        if (typeof body.isActive !== "boolean") {
          return NextResponse.json({ error: "isActive" }, { status: 400 });
        }
        patch.is_active = body.isActive;
        changed.isActive = body.isActive;
      }

      if (Object.keys(patch).length === 1) {
        return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
      }

      const { error } = await db.from("subscription_plans").update(patch).eq("id", planId);
      if (error) {
        console.error("[admin/plans] Plan update failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const { data: actor } = await db
      .from("profiles").select("email").eq("id", check.userId).maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: actor?.email ?? null,
        action: "plan.updated",
        targetType: "subscription_plans",
        targetId: planId,
        targetLabel: null,
        metadata: changed,
      },
      db
    );

    // Price changes do not reach Stripe until a sync runs, so say so explicitly
    // rather than letting an admin assume the new price is live.
    const priceChanged =
      changed.monthlyPrice !== undefined || changed.annualPrice !== undefined;

    return NextResponse.json({ updated: true, changed, syncRequired: priceChanged });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/plans] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    let body: Record<string, unknown> = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "name" }, { status: 400 });

    const monthly = Number(body.monthlyPrice) || 0;
    const annual = Number(body.annualPrice) || 0;
    if (monthly < 0 || annual < 0) {
      return NextResponse.json({ error: "price" }, { status: 400 });
    }

    const db = adminClient();

    const { data: existing } = await db
      .from("subscription_plans")
      .select("display_order")
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: created, error } = await db
      .from("subscription_plans")
      .insert({
        name,
        description: typeof body.description === "string" ? body.description : "",
        tagline: typeof body.tagline === "string" ? body.tagline : "",
        monthly_price: monthly,
        annual_price: annual,
        is_active: true,
        is_default: false,
        display_order: ((existing?.display_order as number) ?? 0) + 1,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[admin/plans] Create failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ created: true, planId: created.id });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/plans] POST error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const url = new URL(req.url);
    const planId = url.searchParams.get("planId");
    if (!planId) return NextResponse.json({ error: "planId" }, { status: 400 });

    const db = adminClient();

    // Refuse if anyone is on it. Deleting would strip their plan_id and silently
    // remove every limit they are governed by.
    const { count } = await db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "plan_in_use", subscribers: count },
        { status: 400 }
      );
    }

    const { error } = await db.from("subscription_plans").delete().eq("id", planId);
    if (error) {
      console.error("[admin/plans] Delete failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/plans] DELETE error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
