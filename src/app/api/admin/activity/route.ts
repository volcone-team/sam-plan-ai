import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/activity
 *
 * Reads the admin audit trail (activity_log, migration 015), newest first.
 * Admin-only; the read uses the service-role client.
 *
 * Query params:
 *   limit       default 50, capped at 200
 *   offset      default 0
 *   action      optional exact-match filter, e.g. 'user.deleted'
 *   actorUserId optional exact-match filter on the acting admin
 *
 * Response:
 *   { entries: [{ id, actorUserId, actorEmail, action, targetType, targetId,
 *                 targetLabel, companyId, metadata, createdAt }],
 *     total }
 *
 * `total` is the exact count for the applied filters (ignoring the page
 * window), so the UI can paginate.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface ActivityRow {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  company_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Parse a positive integer query param, falling back to `fallback`. */
function parseInt0(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return n;
}

export async function GET(request: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/activity] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt0(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const offset = parseInt0(searchParams.get("offset"), 0);
    const action = searchParams.get("action");
    const actorUserId = searchParams.get("actorUserId");

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let query = db
      .from("activity_log")
      .select(
        "id, actor_user_id, actor_email, action, target_type, target_id, target_label, company_id, metadata, created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + Math.max(limit, 1) - 1);

    if (action) query = query.eq("action", action);
    if (actorUserId) query = query.eq("actor_user_id", actorUserId);

    const { data, error, count } = await query;

    if (error) {
      console.error("[admin/activity] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ActivityRow[];

    return NextResponse.json({
      entries: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorEmail: r.actor_email,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        targetLabel: r.target_label,
        companyId: r.company_id,
        metadata: r.metadata ?? {},
        createdAt: r.created_at,
      })),
      total: count ?? 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/activity] Error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
