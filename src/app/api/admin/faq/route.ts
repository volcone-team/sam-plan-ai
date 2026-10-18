import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { loadFaqAdminCatalogue } from "@/lib/faq/admin-repo";
import { adminClient, faqErrorResponse } from "@/lib/faq/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FAQ admin catalogue. ANY ADMIN.
 *
 * GET → { categories, items } — drafts and unpublished categories included.
 * Never reuse this for customers; they get /api/faq (published only).
 *
 * 503 { error: "migration_not_applied", message } until migration 039 is applied.
 */
export async function GET() {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    const catalogue = await loadFaqAdminCatalogue(adminClient());
    return NextResponse.json(catalogue, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    return faqErrorResponse(err, "GET");
  }
}
