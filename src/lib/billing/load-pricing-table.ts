import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/db-errors";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import {
  buildPricingTable,
  PRICING_SECTIONS,
  type PricingCellRecord,
  type PricingPlanRecord,
  type PricingRowRecord,
  type PricingSection,
  type PricingTable,
} from "./pricing-table";

/**
 * Server-side read of the plan comparison table (migration 050) for
 * /get-started and /choose-plan.
 *
 * NEVER THROWS, and returns null whenever there is no table to show:
 *   - migration 050 not applied (missing table or column),
 *   - any other read error,
 *   - no active rows,
 *   - no active plans.
 * Callers treat null as "render the plan cards shown today". Failing to the
 * existing cards is the only safe direction: a broken comparison table must
 * never stand between a visitor and the plan picker.
 *
 * Uses a cookie-free service-role client by default because /get-started is
 * public (no session) and subscription_plans is only readable by
 * authenticated users under RLS (004).
 */

export interface PricingTableData {
  table: PricingTable;
  /** app_settings.pricing_annual_note, null when unset. */
  annualNote: string | null;
  annualNoteValueCents: number | null;
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** int8 arrives as a number from PostgREST; accept a numeric string too. */
function toCents(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const PLAN_COLUMNS =
  "id, name, monthly_price, annual_price, compare_at_monthly_cents, price_label, display_order";

type QueryError = { code?: string | null; message?: string | null } | null;

/** "Migration 050 is not applied" — the expected state until the owner runs it. */
export function isPricingMigrationMissing(err: QueryError): boolean {
  return isMissingTableError(err) || isMissingColumnError(err);
}

export async function loadPricingTable(db?: SupabaseClient): Promise<PricingTableData | null> {
  try {
    const client = db ?? serviceClient();
    const [rowsRes, cellsRes, plansRes, settingsRes] = await Promise.all([
      client
        .from("pricing_rows")
        .select("id, section, label, sublabel, value_cents, display_order, is_active")
        .eq("is_active", true)
        .order("display_order"),
      client.from("pricing_row_plans").select("row_id, plan_id, included, value_cents"),
      client
        .from("subscription_plans")
        .select(PLAN_COLUMNS)
        .eq("is_active", true)
        .order("display_order"),
      client
        .from("app_settings")
        .select("pricing_annual_note, pricing_annual_note_value_cents")
        .eq("id", "global")
        .maybeSingle(),
    ]);

    for (const res of [rowsRes, cellsRes, plansRes, settingsRes]) {
      if (res.error) {
        if (!isPricingMigrationMissing(res.error)) {
          console.error("[load-pricing-table] read failed:", res.error.message);
        }
        return null;
      }
    }

    const rows: PricingRowRecord[] = ((rowsRes.data ?? []) as Record<string, unknown>[])
      .filter((r) => (PRICING_SECTIONS as readonly string[]).includes(String(r.section)))
      .map((r) => ({
        id: String(r.id),
        section: r.section as PricingSection,
        label: String(r.label ?? ""),
        sublabel: typeof r.sublabel === "string" && r.sublabel !== "" ? r.sublabel : null,
        value_cents: toCents(r.value_cents),
        display_order: Number(r.display_order) || 0,
        is_active: r.is_active !== false,
      }));
    const cells: PricingCellRecord[] = ((cellsRes.data ?? []) as Record<string, unknown>[]).map(
      (c) => ({
        row_id: String(c.row_id),
        plan_id: String(c.plan_id),
        included: c.included === true,
        value_cents: toCents(c.value_cents),
      })
    );
    const plans: PricingPlanRecord[] = ((plansRes.data ?? []) as Record<string, unknown>[]).map(
      (p) => ({
        id: String(p.id),
        name: String(p.name ?? ""),
        monthly_price: Number(p.monthly_price) || 0,
        annual_price: Number(p.annual_price) || 0,
        compare_at_monthly_cents: toCents(p.compare_at_monthly_cents),
        price_label: typeof p.price_label === "string" && p.price_label !== "" ? p.price_label : null,
        display_order: Number(p.display_order) || 0,
      })
    );

    if (rows.length === 0 || plans.length === 0) return null;

    const settings = (settingsRes.data ?? null) as Record<string, unknown> | null;
    const note = settings?.pricing_annual_note;
    return {
      table: buildPricingTable(rows, cells, plans),
      annualNote: typeof note === "string" && note.trim() !== "" ? note : null,
      annualNoteValueCents: toCents(settings?.pricing_annual_note_value_cents),
    };
  } catch (err: unknown) {
    console.error(
      "[load-pricing-table] unexpected error:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
