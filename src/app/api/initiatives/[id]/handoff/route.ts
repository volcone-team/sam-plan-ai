import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requirePermission } from "@/lib/require-permission";
import { isInitiativeId } from "@/lib/initiatives/recurring-request";
import { isLeadGen, parseHandoffPatch, withHandoff } from "@/lib/initiatives/lead-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/initiatives/[id]/handoff  { handoffTo: string | null }
 *
 * Sets or clears attrs.lead_handoff_to on a lead-gen initiative, and touches
 * nothing else in attrs. The client-side initiative update does not carry
 * attrs, so this is the one place the handoff is edited after creation.
 *
 * Owner / operator only (`initiatives.edit`). Company from the caller's
 * profile; both initiatives are checked to be the company's, because the
 * service role bypasses RLS. The target must be in the same plan.
 *
 *   200 { ok: true, attrs }
 *   400 { error } — malformed body, itself, or a target outside the plan
 *   401 / 403 / 404 / 409 / 500 { error } — 409: not on the leads path
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    const parsed = parseHandoffPatch(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { handoffTo } = parsed;

    const db = serviceClient();
    const { data: row, error: loadError } = await db
      .from("initiatives")
      .select("id, annual_plan_id, conversion_path, attrs")
      .eq("id", id)
      .eq("company_id", check.companyId)
      .maybeSingle();
    if (loadError) {
      console.error("[initiatives/handoff] load failed:", loadError.message);
      return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });

    if (handoffTo !== null) {
      if (!isLeadGen({ conversionPath: row.conversion_path as string | null })) {
        return NextResponse.json({ error: "Only a lead-collecting initiative hands leads on." }, { status: 409 });
      }
      if (handoffTo === id) {
        return NextResponse.json({ error: "An initiative can't hand leads to itself." }, { status: 400 });
      }
      const { data: target } = isInitiativeId(handoffTo)
        ? await db
            .from("initiatives")
            .select("id")
            .eq("id", handoffTo)
            .eq("company_id", check.companyId)
            .eq("annual_plan_id", row.annual_plan_id)
            .maybeSingle()
        : { data: null };
      if (!target) {
        return NextResponse.json({ error: "Choose an initiative in the same plan." }, { status: 400 });
      }
    }

    const current =
      typeof row.attrs === "object" && row.attrs !== null && !Array.isArray(row.attrs)
        ? (row.attrs as Record<string, unknown>)
        : {};
    const attrs = withHandoff(current, handoffTo);
    const { error } = await db
      .from("initiatives")
      .update({ attrs })
      .eq("id", id)
      .eq("company_id", check.companyId);
    if (error) {
      console.error("[initiatives/handoff] update failed:", error.message);
      return NextResponse.json({ error: "Could not save where the leads go." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, attrs });
  } catch (err: unknown) {
    console.error("[initiatives/handoff] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not save where the leads go." }, { status: 500 });
  }
}
