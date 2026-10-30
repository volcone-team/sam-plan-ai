import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requireCompanyMember } from "@/lib/require-company-member";
import { isInitiativeId } from "@/lib/initiatives/recurring-request";
import { loadLibraryConfigs, toRecordConfig } from "@/lib/intake-v3/config-repo";
import { toPickerItems, type PickerItem } from "@/lib/intake-v3/picker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/initiatives/[id]/form-config
 *
 * The library record config the Add form used for this initiative, so the
 * Edit form can lay out its dates, kind and frequency by the same rules
 * (src/lib/initiatives/edit-layout.ts).
 *
 *   200 { config: LibraryRecordConfig | null, categoryId: string | null }
 *       Both null when the initiative has no library key, or its record has
 *       no complete config. The Edit form then shows every field.
 *   401 / 404 / 500 { error }
 *
 * Unlike the picker this is not gated on the intake-v3 switch or on the
 * record being offered: an initiative already exists and is being edited.
 * Any company member may read; the service role bypasses RLS, so the
 * initiative is checked against the caller's company first.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const check = await requireCompanyMember();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (!isInitiativeId(id)) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

    const db = serviceClient();
    const { data: row, error } = await db
      .from("initiatives")
      .select("library_key, format, audience_source")
      .eq("id", id)
      .eq("company_id", check.companyId)
      .maybeSingle();
    if (error) {
      console.error("[initiatives/form-config] load failed:", error.message);
      return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

    const key = typeof row.library_key === "string" ? row.library_key.trim() : "";
    if (!key) return NextResponse.json({ config: null, categoryId: null });

    const loaded = await loadLibraryConfigs(db);
    if (!loaded.ok) {
      console.error("[initiatives/form-config] library load failed:", loaded.error);
      // Not fatal for editing: the form falls back to showing every field.
      return NextResponse.json({ config: null, categoryId: null });
    }
    const record = loaded.records.find((r) => r.initiativeKey === key);
    const config = record ? toRecordConfig(record.effective) : null;
    /**
     * `item` lets the Overview open the SAME form as Add Initiative
     * (IntakeForm), prefilled. Null when the record cannot be a picker item
     * (no category or audience); the Overview then keeps its own edit form.
     */
    let item: (PickerItem & { revenueScore: number | null }) | null = null;
    if (config && record) {
      const [picked] = toPickerItems([record]);
      if (picked) {
        const { data: lib } = await db
          .from("wb_initiative_library")
          .select("revenue_score")
          .eq("initiative_key", key)
          .maybeSingle();
        const score = (lib as { revenue_score?: unknown } | null)?.revenue_score;
        item = { ...picked, revenueScore: typeof score === "number" ? score : null };
      }
    }
    return NextResponse.json({
      config,
      categoryId: config && record ? record.effective.categoryId ?? null : null,
      item,
      format: typeof row.format === "string" ? row.format : null,
      audienceSource: typeof row.audience_source === "string" ? row.audience_source : null,
    });
  } catch (err: unknown) {
    console.error("[initiatives/form-config] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not load the form settings." }, { status: 500 });
  }
}
