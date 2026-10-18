import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { loadLibrary } from "@/lib/workbook/read";
import { EXCLUDED_PICKER_CATEGORIES } from "@/lib/intake/schema";
import { readRecommendationWeight } from "@/lib/recommend/weight-setting";
import {
  MAX_REVENUE_WEIGHT,
  MIN_REVENUE_WEIGHT,
  REVENUE_WEIGHT_STEP,
  parseRevenueWeight,
} from "@/lib/recommend/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Revenue weight used to rank initiatives by SCORE (migration 041).
 * SUPER-ADMIN ONLY, matching /api/admin/initiative-library.
 *
 * GET → { weight, available, initiatives[] }
 *   `available` is false until migration 041 is applied (weight reads as 1).
 *   `initiatives` is the ACTIVE library (minus Maximizers, as recommend uses
 *   it) with its five scores, so the screen can preview the top 10 under
 *   each weighting without an intake context.
 *
 * PUT { weight: number } → 1-3 in steps of 0.5.
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

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const db = adminClient();
    const excluded = new Set(EXCLUDED_PICKER_CATEGORIES.map((c) => c.toLowerCase()));
    const [state, library] = await Promise.all([readRecommendationWeight(db), loadLibrary(db)]);

    return NextResponse.json({
      weight: state.weight,
      available: state.available,
      initiatives: library
        .filter((e) => !excluded.has((e.category ?? "").toLowerCase()))
        .map((e) => ({
          key: e.initiativeKey,
          name: e.name,
          category: e.category,
          speedScore: e.speedScore,
          costScore: e.costScore,
          oddsScore: e.oddsScore,
          revenueScore: e.revenueScore,
          easeScore: e.easeScore,
        })),
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/recommendation-weight] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    let body: { weight?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const weight = parseRevenueWeight(body.weight);
    if (weight === null) {
      return NextResponse.json(
        {
          error: "weight",
          message: `Weight must be between ${MIN_REVENUE_WEIGHT} and ${MAX_REVENUE_WEIGHT} in steps of ${REVENUE_WEIGHT_STEP}.`,
        },
        { status: 400 }
      );
    }

    const db = adminClient();
    const before = await readRecommendationWeight(db);
    if (!before.available) {
      return NextResponse.json(
        {
          error: "migration_missing",
          message: "Migration 041 has not been applied yet, so the weight cannot be saved. Ranking uses equal weight until then.",
        },
        { status: 503 }
      );
    }

    const { error } = await db.from("app_settings").upsert(
      {
        id: "global",
        recommendation_revenue_weight: weight,
        updated_by: check.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      console.error("[admin/recommendation-weight] Write failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: (actor as { email?: string } | null)?.email ?? null,
        action: "recommendation_weight.updated",
        targetType: "app_settings",
        targetId: "global",
        targetLabel: `Revenue weight ${weight}`,
        metadata: { from: before.weight, to: weight },
      },
      db
    );

    console.log("[admin/recommendation-weight] weight", before.weight, "->", weight);
    return NextResponse.json({ weight });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/recommendation-weight] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
