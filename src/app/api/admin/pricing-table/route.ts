import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { isPricingMigrationMissing } from "@/lib/billing/load-pricing-table";
import {
  cellInputToRecord,
  reorderAfterMove,
  validateAnnualNoteInput,
  validatePlanExtrasInput,
  validatePricingCellInput,
  validatePricingRowInput,
  type FieldErrors,
} from "@/lib/billing/pricing-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The plan comparison table on /get-started and /choose-plan (migration 050).
 *
 * SUPER-ADMIN ONLY, like /api/admin/plans: this is what every prospective
 * customer is told they get for their money.
 *
 * GET    → every row (active and hidden), every cell, every plan's table
 *          extras, the annual note, and `available` (false = 050 missing).
 * POST   → create a row       { section, label, sublabel?, valueCents?, isActive? }
 * PUT    → one change, chosen by `kind`:
 *            row   { kind, id, section, label, sublabel?, valueCents?, isActive? }
 *            move  { kind, rowId, direction: "up" | "down" }
 *            cell  { kind, rowId, planId, state, valueCents? }
 *            plan  { kind, planId, priceLabel?, compareAtMonthlyCents? }
 *            note  { kind, text?, valueCents? }
 * DELETE → ?rowId=  (its cells go with it, ON DELETE CASCADE)
 *
 * All money is integer cents. Any write before 050 is applied answers 409
 * `migration_required`, as /api/admin/call-gate-settings does, so the screen
 * can say so instead of silently discarding the edit.
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

const MIGRATION_REQUIRED = {
  error: "migration_required",
  migration: "050_pricing_table",
  message:
    "Migration 050 (050_pricing_table.sql) has not been applied to this database " +
    "yet, so the comparison table cannot be edited. Run it in the Supabase SQL " +
    "editor, then reload this page. Until then customers see the plan cards.",
} as const;

type DbError = { code?: string | null; message: string } | null;

/** Map a write error to a response, or null when there was none. */
function writeError(error: DbError, context: string): NextResponse | null {
  if (!error) return null;
  if (isPricingMigrationMissing(error)) {
    return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
  }
  // 23503: the row or plan the cell points at does not exist.
  if (error.code === "23503") {
    return NextResponse.json({ error: "not_found", message: "Row or plan not found." }, { status: 404 });
  }
  // 22P02: an id that is not a uuid.
  if (error.code === "22P02") {
    return NextResponse.json({ error: "invalid", errors: { id: "Not a valid id." } }, { status: 400 });
  }
  console.error(`[admin/pricing-table] ${context} failed:`, error.message);
  return NextResponse.json({ error: error.message }, { status: 500 });
}

function invalid(errors: FieldErrors): NextResponse {
  return NextResponse.json({ error: "invalid", errors }, { status: 400 });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function audit(
  db: SupabaseClient,
  userId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  targetLabel: string | null,
  metadata: Record<string, unknown>
) {
  const { data: actor } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
  await logActivity(
    {
      actorUserId: userId,
      actorEmail: (actor as { email?: string } | null)?.email ?? null,
      action,
      targetType,
      targetId,
      targetLabel,
      metadata,
    },
    db
  );
}

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const db = adminClient();
    const [rowsRes, cellsRes, plansRes, settingsRes] = await Promise.all([
      db
        .from("pricing_rows")
        .select("id, section, label, sublabel, value_cents, display_order, is_active")
        .order("display_order"),
      db.from("pricing_row_plans").select("row_id, plan_id, included, value_cents"),
      db
        .from("subscription_plans")
        .select("id, name, is_active, display_order, compare_at_monthly_cents, price_label")
        .order("display_order"),
      db
        .from("app_settings")
        .select("pricing_annual_note, pricing_annual_note_value_cents")
        .eq("id", "global")
        .maybeSingle(),
    ]);
    const results = [rowsRes, cellsRes, plansRes, settingsRes];
    if (results.some((r) => r.error && isPricingMigrationMissing(r.error))) {
      return NextResponse.json({ available: false, ...MIGRATION_REQUIRED });
    }
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error("[admin/pricing-table] GET query failed:", failed.error.message);
      return NextResponse.json({ error: failed.error.message }, { status: 500 });
    }
    const settings = settingsRes.data as Record<string, unknown> | null;
    return NextResponse.json({
      available: true,
      rows: rowsRes.data ?? [],
      cells: cellsRes.data ?? [],
      plans: plansRes.data ?? [],
      annualNote: (settings?.pricing_annual_note as string | null) ?? null,
      annualNoteValueCents: (settings?.pricing_annual_note_value_cents as number | null) ?? null,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/pricing-table] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const body = await readBody(req);
    if (!body) return NextResponse.json({ error: "body" }, { status: 400 });
    const parsed = validatePricingRowInput(body);
    if (!parsed.ok) return invalid(parsed.errors);
    const row = parsed.value;

    const db = adminClient();
    // Append to the end of its section.
    const { data: last, error: lastErr } = await db
      .from("pricing_rows")
      .select("display_order")
      .eq("section", row.section)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastResponse = writeError(lastErr, "Order lookup");
    if (lastResponse) return lastResponse;

    const { data: created, error } = await db
      .from("pricing_rows")
      .insert({
        section: row.section,
        label: row.label,
        sublabel: row.sublabel,
        value_cents: row.valueCents,
        is_active: row.isActive,
        display_order: (((last as { display_order?: number } | null)?.display_order) ?? 0) + 10,
      })
      .select("id")
      .single();
    const createResponse = writeError(error, "Create");
    if (createResponse) return createResponse;

    const id = (created as { id: string }).id;
    await audit(db, check.userId, "pricing_table.row_created", "pricing_rows", id, row.label, { ...row });
    return NextResponse.json({ created: true, id });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/pricing-table] POST error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const body = await readBody(req);
    if (!body) return NextResponse.json({ error: "body" }, { status: 400 });
    const db = adminClient();

    switch (body.kind) {
      case "row": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return invalid({ id: "Required." });
        const parsed = validatePricingRowInput(body);
        if (!parsed.ok) return invalid(parsed.errors);
        const row = parsed.value;
        const { data, error } = await db
          .from("pricing_rows")
          .update({
            section: row.section,
            label: row.label,
            sublabel: row.sublabel,
            value_cents: row.valueCents,
            is_active: row.isActive,
          })
          .eq("id", id)
          .select("id");
        const r = writeError(error, "Row update");
        if (r) return r;
        if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
        await audit(db, check.userId, "pricing_table.row_updated", "pricing_rows", id, row.label, { ...row });
        return NextResponse.json({ updated: true });
      }

      case "move": {
        const rowId = typeof body.rowId === "string" ? body.rowId : "";
        const direction = body.direction;
        if (!rowId || (direction !== "up" && direction !== "down")) {
          return invalid({ ...(rowId ? {} : { rowId: "Required." }), ...(direction === "up" || direction === "down" ? {} : { direction: "Must be up or down." }) });
        }
        const { data: rows, error } = await db
          .from("pricing_rows")
          .select("id, section, display_order, label");
        const r = writeError(error, "Move lookup");
        if (r) return r;
        const list = (rows ?? []) as { id: string; section: "included" | "bonus"; display_order: number; label: string }[];
        if (!list.some((x) => x.id === rowId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
        const next = reorderAfterMove(list, rowId, direction);
        // Already first / last: nothing to do, and not an error.
        if (!next) return NextResponse.json({ updated: false });
        // NOT TRANSACTIONAL: one UPDATE per row, only where the order changed.
        // A failure midway leaves a harmless mixed order; moving again fixes it.
        const current = new Map(list.map((x) => [x.id, x.display_order]));
        for (const n of next) {
          if (current.get(n.id) === n.display_order) continue;
          const { error: uErr } = await db
            .from("pricing_rows")
            .update({ display_order: n.display_order })
            .eq("id", n.id);
          const ur = writeError(uErr, "Move");
          if (ur) return ur;
        }
        await audit(db, check.userId, "pricing_table.row_moved", "pricing_rows", rowId, null, { direction });
        return NextResponse.json({ updated: true });
      }

      case "cell": {
        const parsed = validatePricingCellInput(body);
        if (!parsed.ok) return invalid(parsed.errors);
        const record = cellInputToRecord(parsed.value);
        const { error } = await db
          .from("pricing_row_plans")
          .upsert(record, { onConflict: "row_id,plan_id" });
        const r = writeError(error, "Cell upsert");
        if (r) return r;
        await audit(db, check.userId, "pricing_table.cell_updated", "pricing_row_plans", parsed.value.rowId, null, { ...parsed.value });
        return NextResponse.json({ updated: true });
      }

      case "plan": {
        const parsed = validatePlanExtrasInput(body);
        if (!parsed.ok) return invalid(parsed.errors);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (parsed.value.priceLabel !== undefined) patch.price_label = parsed.value.priceLabel;
        if (parsed.value.compareAtMonthlyCents !== undefined) {
          patch.compare_at_monthly_cents = parsed.value.compareAtMonthlyCents;
        }
        const { data, error } = await db
          .from("subscription_plans")
          .update(patch)
          .eq("id", parsed.value.planId)
          .select("id, name");
        const r = writeError(error, "Plan update");
        if (r) return r;
        if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
        await audit(db, check.userId, "pricing_table.plan_updated", "subscription_plans", parsed.value.planId, (data[0] as { name?: string }).name ?? null, { ...parsed.value });
        return NextResponse.json({ updated: true });
      }

      case "note": {
        const parsed = validateAnnualNoteInput(body);
        if (!parsed.ok) return invalid(parsed.errors);
        const patch: Record<string, unknown> = {
          id: "global",
          updated_by: check.userId,
          updated_at: new Date().toISOString(),
        };
        if (parsed.value.text !== undefined) patch.pricing_annual_note = parsed.value.text;
        if (parsed.value.valueCents !== undefined) {
          patch.pricing_annual_note_value_cents = parsed.value.valueCents;
        }
        const { error } = await db.from("app_settings").upsert(patch, { onConflict: "id" });
        const r = writeError(error, "Annual note");
        if (r) return r;
        await audit(db, check.userId, "pricing_table.annual_note_updated", "app_settings", null, "pricing_annual_note", { ...parsed.value });
        return NextResponse.json({ updated: true });
      }

      default:
        return invalid({ kind: "Must be row, move, cell, plan or note." });
    }
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/pricing-table] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const rowId = new URL(req.url).searchParams.get("rowId");
    if (!rowId) return invalid({ rowId: "Required." });
    const db = adminClient();
    const { data, error } = await db
      .from("pricing_rows")
      .delete()
      .eq("id", rowId)
      .select("id, label");
    const r = writeError(error, "Delete");
    if (r) return r;
    if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await audit(db, check.userId, "pricing_table.row_deleted", "pricing_rows", rowId, (data[0] as { label?: string }).label ?? null, {});
    return NextResponse.json({ deleted: true });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/pricing-table] DELETE error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
