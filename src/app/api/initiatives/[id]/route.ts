import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requirePermission } from "@/lib/require-permission";
import { parseCreateInitiativeRequest } from "@/lib/initiatives/create-request";
import { isInitiativeId } from "@/lib/initiatives/recurring-request";
import { readHandoffId, withHandoff } from "@/lib/initiatives/lead-handoff";
import { withOccurrenceFallback } from "@/lib/initiatives/occurrences";
import { initiativeFrequencyFallback, isCheckViolation } from "@/lib/initiatives/frequency-fallback";
import { loadLibraryConfigs, toRecordConfig } from "@/lib/intake-v3/config-repo";
import { mergeEditedAttrs } from "@/lib/intake-v3/edit-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/**
 * PUT /api/initiatives/[id] — save an initiative edited in the SAME form as
 * Add Initiative (client, Oct 2026).
 *
 * The body is exactly what the Add form posts (CreateInitiativeRequest, built
 * by buildCreateRequest), so every answer is written to the same column or
 * attrs key it was created in. attrs is MERGED: the form's own keys are
 * replaced, anything else on the row (moved occurrences, fallbacks written
 * before a migration) is kept. See mergeEditedAttrs.
 *
 * NOT changed by an edit: the plan year the row is filed under, its status,
 * its type, its tasks, its actuals and its spend.
 *
 * PERMISSION: initiatives.edit. Company from the caller's profile; the row,
 * product and handoff target are checked against it (service role bypasses RLS).
 *
 * Responses: 200 { id } · 400 · 401/403 · 404 · 409 (library key mismatch) · 500
 */
export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const check = await requirePermission("initiatives.edit");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const { companyId } = check;
    if (!isInitiativeId(id)) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

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
    const { data: row, error: loadError } = await db
      .from("initiatives")
      .select("id, annual_plan_id, library_key, attrs")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (loadError) {
      console.error("[initiatives/update] load failed:", loadError.message);
      return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

    const libraryKey = typeof row.library_key === "string" ? row.library_key.trim() : "";
    if (!libraryKey || libraryKey !== req.libraryKey) {
      return NextResponse.json({ error: "This initiative can't be edited with that form." }, { status: 409 });
    }

    if (req.productId !== null) {
      const { data: product } = await db
        .from("products")
        .select("id")
        .eq("id", req.productId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!product) return NextResponse.json({ error: "That product was not found." }, { status: 404 });
    }

    // Lead handoff: one of this company's initiatives in the same plan, not itself.
    const handoffTo = readHandoffId(req.attrs);
    if (handoffTo !== null && req.attrs) {
      const { data: target } =
        isInitiativeId(handoffTo) && handoffTo !== id
          ? await db
              .from("initiatives")
              .select("id")
              .eq("id", handoffTo)
              .eq("company_id", companyId)
              .eq("annual_plan_id", row.annual_plan_id as string)
              .maybeSingle()
          : { data: null };
      if (!target) req.attrs = withHandoff(req.attrs, null);
    }

    // The record's extras decide which attrs keys the form owns.
    const loaded = await loadLibraryConfigs(db);
    const record = loaded.ok ? loaded.records.find((r) => r.initiativeKey === libraryKey) : undefined;
    const config = record ? toRecordConfig(record.effective) : null;
    const savedAttrs = (row.attrs && typeof row.attrs === "object" ? row.attrs : {}) as Row;
    const attrs = mergeEditedAttrs(savedAttrs, req.attrs ?? {}, config ?? { fieldExtras: [] });

    const recurring = req.kind === "recurring";
    const frequency = recurring && typeof attrs.repeat_frequency === "string" ? attrs.repeat_frequency : null;

    const patch: Row = {
      name: req.name,
      description: req.description,
      kind: req.kind,
      product_id: req.productId,
      // A start date the record's form does not ask for comes back null; keep
      // the stored one (set by the older edit form) rather than wipe it. Where
      // it IS asked it is required, so null never means "cleared".
      ...(req.activationDate !== null ? { activation_date: req.activationDate } : {}),
      event_date: req.eventDate,
      planned_budget: req.plannedBudget,
      revenue_good: req.revenueScenarios.good,
      revenue_better: req.revenueScenarios.better,
      revenue_best: req.revenueScenarios.best,
      // Unset in the request = cleared: an edit replaces the answer.
      conversion_path: req.conversionPath ?? null,
      format: req.format ?? null,
      ...(req.audienceSource !== undefined ? { audience_source: req.audienceSource } : {}),
      ...(req.categoryId !== undefined ? { category_id: req.categoryId } : {}),
      revenue_close_date: req.revenueCloseDate ?? null,
      ...(req.activationDate !== null ? { activation_date_precision: req.activationDatePrecision ?? "day" } : {}),
      event_date_precision: req.eventDatePrecision ?? "day",
      // The 036 column is read before attrs, so it must follow the edit.
      repeat_frequency: frequency,
      attrs,
      // Migration 061. Recurring only; cleared otherwise.
      last_occurrence_date: recurring ? req.lastOccurrenceDate ?? null : null,
      revenue_per_occurrence: recurring ? req.revenuePerOccurrence ?? null : null,
      // Units x price: absent = the target is in dollars.
      units_goal: req.unitsGoal ?? null,
      unit_price_at_set: req.unitPriceAtSet ?? null,
      target_source: req.targetSource ?? null,
      updated_at: new Date().toISOString(),
    };

    const run = (p: Row) =>
      withOccurrenceFallback(
        p,
        (r) => db.from("initiatives").update(r).eq("id", id).eq("company_id", companyId).select("id").single(),
        "[initiatives/update]",
        async () => attrs
      );
    let { error } = await run(patch);
    // A frequency the CHECK does not accept yet (051 not applied): keep it in attrs.
    if (isCheckViolation(error)) {
      const retry = initiativeFrequencyFallback(patch, attrs);
      if (retry) ({ error } = await run(retry));
    }
    if (error) {
      console.error("[initiatives/update] update failed:", error.message);
      return NextResponse.json({ error: "Could not save the initiative." }, { status: 500 });
    }
    return NextResponse.json({ id });
  } catch (err: unknown) {
    console.error("[initiatives/update] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not save the initiative." }, { status: 500 });
  }
}
