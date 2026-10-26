import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { requireCompanyMember } from "@/lib/require-company-member";
import { isInitiativeId } from "@/lib/initiatives/recurring-request";
import { loadAiContextForKey, loadLibraryScoresForKey, type LibraryScores } from "@/lib/workbook/read";
import { aiContextResponse } from "@/lib/initiatives/why-score";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * GET /api/initiatives/[id]/ai-context
 *
 * What "Why This Initiative" shows for the initiative's library key: the
 * workbook AI Context entry (wb_ai_context) and the SCORE from its library
 * row (wb_initiative_library).
 *
 *   200 { entry: ContextEntry | null, score: WhyScore | null }
 *       entry null when there is no library key or nothing is authored;
 *       score null when there is no key, no library row, or no usable score.
 *       A failed score lookup is logged and returns score null rather than
 *       losing the entry.
 *   401 / 400 / 404 / 500 { error }
 *
 * Any company member may read. The service role bypasses RLS, so the
 * initiative is checked to belong to the caller's company first.
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
      .select("library_key")
      .eq("id", id)
      .eq("company_id", check.companyId)
      .maybeSingle();
    if (error) {
      console.error("[initiatives/ai-context] load failed:", error.message);
      return NextResponse.json({ error: "Could not load the initiative." }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    const key = typeof row.library_key === "string" ? row.library_key.trim() : "";
    if (!key) return NextResponse.json(aiContextResponse(null, null));
    const [entry, scores] = await Promise.all([
      loadAiContextForKey(db, key),
      loadLibraryScoresForKey(db, key).catch((err: unknown): LibraryScores | null => {
        console.error(
          "[initiatives/ai-context] score lookup failed:",
          err instanceof Error ? err.message : String(err)
        );
        return null;
      }),
    ]);
    return NextResponse.json(aiContextResponse(entry, scores));
  } catch (err: unknown) {
    console.error("[initiatives/ai-context] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not load the initiative guidance." }, { status: 500 });
  }
}
