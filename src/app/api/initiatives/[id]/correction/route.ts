import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requirePermission } from "@/lib/require-permission";
import { RECURRING_DISABLED, isRecurringMigrationMissing } from "@/lib/initiatives/recurring-migration";
import { isInitiativeId, parseCorrectionRequest } from "@/lib/initiatives/recurring-request";
import { correctionUpdate, recurringScope } from "@/lib/initiatives/recurring-state";
import { loadRecurringInitiative } from "@/lib/initiatives/recurring-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/initiatives/[id]/correction  { action }
 *
 * Applies the user's choice on the skip-streak / four-quiet-weeks prompt:
 *   change-frequency — repeat_frequency one step lower
 *   pause            — status 'paused'
 *   retire           — status 'retired'
 *   keep             — correction_kept_at = now (restarts the streak)
 *
 * Owner / operator only (`initiatives.edit`).
 *   200 { enabled: true, ok: true, action }
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
    const parsed = parseCorrectionRequest(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { action } = parsed.value;

    const db = serviceClient();
    // Selects correction_kept_at, so this is also the 046 probe: without the
    // column the prompt was never shown and nothing is written.
    const loaded = await loadRecurringInitiative(db, check.companyId, id);
    if (loaded.kind === "disabled") return NextResponse.json(RECURRING_DISABLED);
    if (loaded.kind === "not-found") return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    if (loaded.kind === "error") return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });

    const { row } = loaded.value;
    const decision = correctionUpdate(action, recurringScope(row), row, new Date().toISOString());
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

    const { error } = await db
      .from("initiatives")
      .update(decision.value)
      .eq("id", id)
      .eq("company_id", check.companyId);
    if (error) {
      if (isRecurringMigrationMissing(error)) return NextResponse.json(RECURRING_DISABLED);
      console.error("[initiatives/correction] update failed:", error.message);
      return NextResponse.json({ error: "Could not apply that choice." }, { status: 500 });
    }
    return NextResponse.json({ enabled: true, ok: true, action });
  } catch (err: unknown) {
    console.error("[initiatives/correction] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not apply that choice." }, { status: 500 });
  }
}
