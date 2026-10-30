import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { checkLiveLimit, liveLimitResponse } from "@/lib/billing/live-limits";
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
import { resolveTasks } from "@/lib/workbook/tasks-for-initiatives";
import { todayDateOnly } from "@/lib/plan-dates";
import { taskAnchorDate } from "@/lib/initiatives/schedule";
import { readHandoffId, withHandoff } from "@/lib/initiatives/lead-handoff";
import { isInitiativeId } from "@/lib/initiatives/recurring-request";
import { planYearForInitiative } from "@/lib/intake/plan-years";
import { findAnnualPlan, getOrCreateAnnualPlan } from "@/lib/plans/annual-plan-store";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withOccurrenceFallback } from "@/lib/initiatives/occurrences";
import { answersFromInitiative, type TaskAnswers } from "@/lib/workbook/task-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The task list for an untemplated library pick may involve a ~30s AI call. */
export const maxDuration = 60;

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
 *   402 / 403 { error, code: "limit_reached" | "not_included", message } —
 *                   the plan year already holds the plan's max_initiatives
 *   404 { error } — plan or product is not this company's
 *   422 { error } — the library initiative is no longer offered
 *   500 { error }
 */
export async function POST(request: NextRequest) {
  try {
    const check = await requirePermission("initiatives.create");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const { companyId, userId } = check;

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
      db.from("annual_plans").select("id, year").eq("id", req.annualPlanId).eq("company_id", companyId).maybeSingle(),
      // productId is null only on a new-form request (the parser guarantees it).
      req.productId === null
        ? Promise.resolve({ data: null })
        : db.from("products").select("id").eq("id", req.productId).eq("company_id", companyId).maybeSingle(),
    ]);
    if (!plan) return NextResponse.json({ error: "That plan was not found." }, { status: 404 });
    if (req.productId !== null && !product) {
      return NextResponse.json({ error: "That product was not found." }, { status: 404 });
    }

    /**
     * FILED UNDER ITS LAUNCH YEAR, not the page's. The panel passes the plan
     * of whichever year the page has selected, so an initiative dated
     * Oct 2026 added while 2028 was selected used to land in the 2028 plan —
     * and the dashboard then borrowed that plan's $0 targets for 2026.
     *
     * The passed plan is still checked above (it proves the caller's plan
     * belongs to their company) and is kept for an undated initiative. A
     * missing launch-year row is created as a DRAFT with zero targets, but
     * only after the limit check below passes, so a refused request writes
     * nothing.
     */
    const passedYear = typeof plan.year === "number" ? plan.year : Number(plan.year);
    const targetYear = planYearForInitiative(req, passedYear);
    let targetPlanId: string | null =
      targetYear === passedYear
        ? (plan.id as string)
        : (await findAnnualPlan(db, companyId, targetYear))?.id ?? null;

    /**
     * Lead handoff target: must be one of this company's initiatives in the
     * plan the panel showed or the plan this initiative is filed under (they
     * differ when the dates move it to another year). Anything else is dropped
     * (written as "Decide later") rather than refused — the handoff is
     * optional and only ever warns.
     */
    const handoffTo = readHandoffId(req.attrs);
    if (handoffTo !== null && req.attrs) {
      const planIds = [...new Set([plan.id as string, ...(targetPlanId ? [targetPlanId] : [])])];
      const { data: target } = isInitiativeId(handoffTo)
        ? await db
            .from("initiatives")
            .select("id")
            .eq("id", handoffTo)
            .eq("company_id", companyId)
            .in("annual_plan_id", planIds)
            .maybeSingle()
        : { data: null };
      if (!target) req.attrs = withHandoff(req.attrs, null);
    }

    /* ---- Plan limit: max_initiatives, live, per plan year ---- */

    // Before anything is written, including a custom initiative type or the
    // launch year's plan row. No row yet counts as an empty year.
    const limit = await checkLiveLimit(db, companyId, LIMIT_KEYS.MAX_INITIATIVES, 1, {
      annualPlanId: targetPlanId,
      year: Number.isInteger(targetYear) ? targetYear : null,
    });
    if (!limit.ok) return liveLimitResponse(limit);

    if (!targetPlanId) {
      const created = await getOrCreateAnnualPlan(
        db, companyId, targetYear, { status: "draft" }, "[initiatives/create]"
      );
      if (!created) {
        return NextResponse.json({ error: "Could not save the initiative. Please try again." }, { status: 500 });
      }
      targetPlanId = created.id;
    }

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
        annual_plan_id: targetPlanId,
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
        // Migration 045 columns: written only when the body carried them, so a
        // request without them inserts exactly the row it always did.
        ...(req.conversionPath !== undefined ? { conversion_path: req.conversionPath } : {}),
        ...(req.audienceSource !== undefined ? { audience_source: req.audienceSource } : {}),
        ...(req.format !== undefined ? { format: req.format } : {}),
        ...(req.categoryId !== undefined ? { category_id: req.categoryId } : {}),
        ...(req.revenueCloseDate !== undefined ? { revenue_close_date: req.revenueCloseDate } : {}),
        ...(req.activationDatePrecision !== undefined ? { activation_date_precision: req.activationDatePrecision } : {}),
        ...(req.eventDatePrecision !== undefined ? { event_date_precision: req.eventDatePrecision } : {}),
        ...(req.attrs !== undefined ? { attrs: req.attrs } : {}),
        // Migration 061, recurring only. Kept in attrs when 061 is not applied.
        ...(req.lastOccurrenceDate !== undefined ? { last_occurrence_date: req.lastOccurrenceDate } : {}),
        ...(req.revenuePerOccurrence !== undefined ? { revenue_per_occurrence: req.revenuePerOccurrence } : {}),
        // Migration 061: units x price (units per occurrence when recurring).
        ...(req.unitsGoal !== undefined ? { units_goal: req.unitsGoal } : {}),
        ...(req.unitPriceAtSet !== undefined ? { unit_price_at_set: req.unitPriceAtSet } : {}),
        ...(req.targetSource !== undefined ? { target_source: req.targetSource } : {}),
      },
      req.libraryKey,
      (row) =>
        withOccurrenceFallback(
          row,
          (r) => db.from("initiatives").insert(r).select("id").single(),
          "[initiatives/create]"
        ),
      metricSet
    );

    if (error || !created) {
      console.error("[initiatives/create] insert failed:", error?.message);
      return NextResponse.json({ error: error?.message || "Could not save the initiative." }, { status: 500 });
    }

    /**
     * THE PROJECT PLAN. This route previously created none at all, so an
     * initiative added by hand arrived with an empty task list while the same
     * library pick made by intake build or generation arrived with the
     * workbook's tasks — the same "nothing to do" symptom, from a different
     * path. Resolved by the shared helper: workbook template, else AI-written,
     * else the generic starter.
     *
     * A CUSTOM initiative (no library key) still gets none. There is nothing
     * to look up and nothing to describe to the model; the user is writing
     * their own initiative and can add their own tasks.
     *
     * Non-fatal on purpose: the initiative is already saved and the response
     * is a 201 either way. Failing here would tell the user their initiative
     * was not created when it was.
     */
    let taskCount = 0;
    if (req.libraryKey) {
      taskCount = await attachTasks(db, {
        companyId,
        initiativeId: created.id as string,
        libraryKey: req.libraryKey,
        /**
         * Tasks count BACK from the event. An evergreen or recurring
         * initiative may have no event date, and the activation date is the
         * only anchor there is — preparation work then lands on or before the
         * day the initiative starts, which is the right end of it.
         */
        // Both dates may be unset on a new-form request; today is the anchor then.
        eventDate: taskAnchorDate(req, todayDateOnly()),
        userId,
        // The form's answers choose the task sections (client, Oct 2026).
        answers: answersFromInitiative({
          conversionPath: req.conversionPath ?? null,
          format: req.format ?? null,
          categoryId: req.categoryId ?? null,
          attrs: req.attrs ?? null,
        }),
      });
    }

    return NextResponse.json({ id: created.id, taskCount }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[initiatives/create] failed:", message);
    return NextResponse.json({ error: "Could not save the initiative." }, { status: 500 });
  }
}

/**
 * Resolve and insert the task list for a just-created initiative.
 *
 * Returns how many tasks were attached; 0 on any failure. NEVER throws: the
 * initiative is already saved, so a task problem must not turn a success into
 * an error response. It is logged loudly instead.
 */
async function attachTasks(
  db: SupabaseClient,
  args: {
    companyId: string;
    initiativeId: string;
    libraryKey: string;
    eventDate: string;
    userId: string | null;
    answers?: TaskAnswers;
  }
): Promise<number> {
  try {
    const resolved = await resolveTasks(
      db,
      [{ libraryKey: args.libraryKey, eventDate: args.eventDate, floor: todayDateOnly(), answers: args.answers }],
      { companyId: args.companyId, userId: args.userId, logLabel: "[initiatives/create]" }
    );
    const entry = resolved.get(args.libraryKey);
    if (!entry || entry.tasks.length === 0) return 0;

    const { error } = await db.from("tasks").insert(
      entry.tasks.map((t) => ({
        id: t.id,
        initiative_id: args.initiativeId,
        company_id: args.companyId,
        name: t.name,
        description: t.description,
        due_date: t.dueDate,
        estimated_hours: t.estimatedHours,
        status: "not_started",
        priority: t.priority,
        display_order: t.displayOrder,
        dependency_ids: t.dependencyIds,
      }))
    );
    if (error) {
      console.error("[initiatives/create] task insert failed:", error.message);
      return 0;
    }
    console.log(
      "[initiatives/create] attached", entry.tasks.length, entry.source, "tasks to", args.libraryKey
    );
    return entry.tasks.length;
  } catch (err: unknown) {
    console.error(
      "[initiatives/create] task resolution failed:",
      err instanceof Error ? err.message : String(err)
    );
    return 0;
  }
}
