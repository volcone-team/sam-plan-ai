import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { loadAdminCatalogue } from "@/lib/university/admin-repo";
import { adminClient, errorResponse } from "@/lib/university/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SAM University admin catalogue. ANY ADMIN (approved decision).
 *
 * GET → { categories, resources, plans }
 *   - resources carry their url and planIds (admin only — never reuse this
 *     route for customers; they get /api/university, which strips urls).
 *   - plans are ALL subscription plans, retired included, by display_order.
 *
 * 503 { error: "migration_not_applied", message } when migration 038 is not
 * applied yet, so the screen can say so plainly.
 */
export async function GET() {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    const catalogue = await loadAdminCatalogue(adminClient());
    return NextResponse.json(catalogue);
  } catch (err: unknown) {
    return errorResponse(err, "GET");
  }
}
