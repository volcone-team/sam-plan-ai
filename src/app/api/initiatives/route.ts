import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requirePermission } from "@/lib/require-permission";
import { parseCreateInitiativeRequest } from "@/lib/initiatives/create-request";
import { loadLibrary } from "@/lib/workbook/read";
import {
  insertWithLibraryKey,
  resolveInitiativeTypeId,
  supabaseTypeStore,
} from "@/lib/workbook/initiative-type";
import { resolveLibraryMetricSet } from "@/lib/metrics/library-metric-set";
import type { InitiativeMetricSet } from "@/lib/metrics/metric-set";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/initiatives — create one initiative from the Add Initiative panel.
 *
 * Server-side because a library pick has to be mapped to an `initiative_types`
 * row, which may mean creating one, and customers cannot write that table. The
 * mapping is the shared rule in src/lib/workbook/initiative-type.ts — the same
 * one intake build and generate-plan use — so a pick here never clones a type.
 *
 * PERMISSION mirrors the panel's own gate: `initiatives.create` (owner and
 * operator). Company comes from the caller's profile, never the body, and the
 * plan and product are checked to belong to it because the service role
 * bypasses RLS.
 *
 * Responses:
 *   201 { id }
 *   400 { error } — malformed body, or a metric selection naming a format or
 *                   metric the library row does not have
 *   401 / 403 { error } — not signed in / role may not create
 *   404 { error } — plan or product is not this company's
 *   422 { error } — the library initiative is no longer offered
 *   500 { error }
 */
export async function POST(request: NextRequest) {
  try {
    const check = await requirePermission("initiatives.create");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const { companyId } = check;

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = parseCreateInitiativeRequest(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const req = parsed.value;

    const db = serviceClient();

    const [{ data: plan }, { data: product }] = await Promise.all([
      db.from("annual_plans").select("id").eq("id", req.annualPlanId).eq("company_id", companyId).maybeSingle(),
      db.from("products").select("id").eq("id", req.productId).eq("company_id", companyId).maybeSingle(),
    ]);
    if (!plan) return NextResponse.json({ error: "That plan was not found." }, { status: 404 });
    if (!product) return NextResponse.json({ error: "That product was not found." }, { status: 404 });

    /* ---- The initiative type ---- */

    let typeId: string | null = null;
    let metricSet: InitiativeMetricSet | null = null;

    if (req.libraryKey) {
      // Active only: the panel lists the active library, so anything else is a
      // stale panel or a hand-made request.
      const entry = (await loadLibrary(db)).find((e) => e.initiativeKey === req.libraryKey);
      if (!entry) {
        return NextResponse.json(
          { error: "That initiative is no longer offered. Pick another, or add a custom one." },
          { status: 422 }
        );
      }

      // Built HERE from the library row; the body only says which formats and
      // optional metrics. Checked before any type is created.
      const resolved = resolveLibraryMetricSet(
        entry.initiativeKey,
        entry,
        req.metricSelection ?? {}
      );
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
      metricSet = resolved.metricSet;

      typeId = await resolveInitiativeTypeId(
        supabaseTypeStore(db, "[initiatives/create]"),
        entry.initiativeKey,
        { name: entry.name, oneLiner: entry.oneLiner, difficulty: entry.difficulty }
      );
    } else {
      /**
       * "Custom initiative": a user-owned type named after the initiative,
       * exactly as the browser used to create it. One per custom initiative
       * is the existing behaviour (the custom type carries its own name), so
       * it is kept rather than folded into a shared row.
       */
      const { data: created, error } = await db
        .from("initiative_types")
        .insert({
          name: req.name,
          channel: "custom",
          description: req.description,
          owner: "user",
          benchmarks: {},
          project_template: { tasks: [], totalEstimatedHours: 0 },
          difficulty: { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
          ai_context: { description: "", sizingGuidance: "", recommendationWeights: {} },
          tier: 1,
          display_order: 999,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) console.error("[initiatives/create] custom type insert failed:", error.message);
      typeId = typeof created?.id === "string" ? created.id : null;
    }

    if (!typeId) {
      return NextResponse.json({ error: "Could not save the initiative. Please try again." }, { status: 500 });
    }

    /* ---- The initiative ---- */

    const { data: created, error } = await insertWithLibraryKey(
      {
        company_id: companyId,
        annual_plan_id: req.annualPlanId,
        product_id: req.productId,
        initiative_type_id: typeId,
        name: req.name,
        description: req.description,
        kind: req.kind,
        status: "planned",
        activation_date: req.activationDate,
        event_date: req.eventDate,
        traffic_input: req.trafficInput,
        revenue_good: req.revenueScenarios.good,
        revenue_better: req.revenueScenarios.better,
        revenue_best: req.revenueScenarios.best,
        planned_budget: req.plannedBudget,
        actual_spend: 0,
        display_order: 0,
      },
      req.libraryKey,
      (row) => db.from("initiatives").insert(row).select("id").single(),
      metricSet
    );

    if (error || !created) {
      console.error("[initiatives/create] insert failed:", error?.message);
      return NextResponse.json({ error: error?.message || "Could not save the initiative." }, { status: 500 });
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[initiatives/create] failed:", message);
    return NextResponse.json({ error: "Could not save the initiative." }, { status: 500 });
  }
}
