import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requirePermission } from "@/lib/require-permission";
import { requireCompanyMember } from "@/lib/require-company-member";
import { roleHasPermission } from "@/lib/permissions";
import { toDateOnly, todayDateOnly } from "@/lib/plan-dates";
import { RECURRING_DISABLED, isRecurringMigrationMissing } from "@/lib/initiatives/recurring-migration";
import { isInitiativeId, parseInstanceRequest } from "@/lib/initiatives/recurring-request";
import { buildRecurringState, instanceWriteDecision, recurringScope } from "@/lib/initiatives/recurring-state";
import { loadInstances, loadLastActualDate, loadRecurringInitiative } from "@/lib/initiatives/recurring-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/initiatives/[id]/instances
 *
 * The recurring prompts for one initiative (see src/lib/initiatives/recurring-state.ts):
 *   200 { enabled: true, scope, canEdit, instances, duePrompts, correction }
 *   200 { enabled: false } — migration 046 is not applied
 *   401 / 400 / 404 / 500 { error }
 *
 * Any company member may read; `canEdit` says whether this caller may answer.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const check = await requireCompanyMember();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (!isInitiativeId(id)) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

    const db = serviceClient();
    const loaded = await loadRecurringInitiative(db, check.companyId, id);
    if (loaded.kind === "disabled") return NextResponse.json(RECURRING_DISABLED);
    if (loaded.kind === "not-found") return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    if (loaded.kind === "error") return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });
    const { row, planYear } = loaded.value;

    const scope = recurringScope(row);
    let materialised: Awaited<ReturnType<typeof loadInstances>> = { kind: "ok", value: [] };
    let lastActual: Awaited<ReturnType<typeof loadLastActualDate>> = { kind: "ok", value: null };
    if (scope.type === "recurring") materialised = await loadInstances(db, check.companyId, id);
    if (scope.type === "ongoing") lastActual = await loadLastActualDate(db, check.companyId, id);
    if (materialised.kind === "disabled" || lastActual.kind === "disabled") {
      return NextResponse.json(RECURRING_DISABLED);
    }
    if (materialised.kind !== "ok" || lastActual.kind !== "ok") {
      return NextResponse.json({ error: "Could not load the initiative's runs." }, { status: 500 });
    }

    const state = buildRecurringState({
      row,
      planYear,
      materialised: materialised.value,
      lastActualDate: lastActual.value,
      today: toDateOnly(todayDateOnly()),
    });

    return NextResponse.json({
      enabled: true,
      canEdit: roleHasPermission(check.role, "initiatives.edit"),
      planYear,
      ...state,
    });
  } catch (err: unknown) {
    console.error("[initiatives/instances] GET failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not load the initiative's runs." }, { status: 500 });
  }
}

/**
 * POST /api/initiatives/[id]/instances  { instanceDate, outcome, actualRevenue? }
 *
 * Records the user's answer for one run, turning its placeholder into an
 * `initiative_instances` row (or updating the row already there). The date
 * must be one the template produces in the plan year.
 *
 * Owner / operator only (`initiatives.edit`), matching 046's write policies.
 *   200 { enabled: true, ok: true }
 *   200 { enabled: false } — migration 046 is not applied; nothing written
 *   400 / 401 / 403 / 404 / 409 / 500 { error }
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const check = await requirePermission("initiatives.edit");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (!isInitiativeId(id)) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const parsed = parseInstanceRequest(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const req = parsed.value;

    const db = serviceClient();
    const loaded = await loadRecurringInitiative(db, check.companyId, id);
    if (loaded.kind === "disabled") return NextResponse.json(RECURRING_DISABLED);
    if (loaded.kind === "not-found") return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    if (loaded.kind === "error") return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });

    const decision = instanceWriteDecision(recurringScope(loaded.value.row), loaded.value.planYear, req.instanceDate);
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

    const { error } = await db.from("initiative_instances").upsert(
      {
        initiative_id: id,
        company_id: check.companyId,
        instance_date: req.instanceDate,
        outcome: req.outcome,
        // Absent leaves a stored figure alone; null clears it.
        ...(req.actualRevenue !== undefined ? { actual_revenue: req.actualRevenue } : {}),
      },
      { onConflict: "initiative_id,instance_date" }
    );
    if (error) {
      if (isRecurringMigrationMissing(error)) return NextResponse.json(RECURRING_DISABLED);
      console.error("[initiatives/instances] upsert failed:", error.message);
      return NextResponse.json({ error: "Could not save that answer." }, { status: 500 });
    }
    return NextResponse.json({ enabled: true, ok: true });
  } catch (err: unknown) {
    console.error("[initiatives/instances] POST failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not save that answer." }, { status: 500 });
  }
}
