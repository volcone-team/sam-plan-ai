import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { computeAiMetrics, type GenerationEventRow } from "@/lib/generation-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/ai
 *
 * Real numbers for the admin Analytics > AI tab, replacing the hardcoded
 * placeholders that used to live in the component.
 *
 * Admin-only; reads generation_events (migrations 011 + 016) with the
 * service-role client.
 *
 * Response:
 *   { metrics: { totalGenerations, generationsPerDay, successRatePct,
 *                avgDurationMs },
 *     recent: [{ id, createdAt, eventType, status, model, durationMs,
 *                tokensInput, tokensOutput, userEmail, companyName }],
 *     migrationRequired }
 *
 * migrationRequired is true when migration 016's columns are missing — the
 * caller then shows a "apply the migration" notice instead of a 500, because a
 * pending migration is an operator task, not a server fault.
 */

const RECENT_LIMIT = 10;
const WINDOW_DAYS = 30;

const EMPTY_METRICS = {
  totalGenerations: 0,
  generationsPerDay: 0,
  successRatePct: null as number | null,
  avgDurationMs: null as number | null,
};

interface EventRow extends GenerationEventRow {
  id: string;
  company_id: string | null;
  user_id: string | null;
  model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
}

/** PostgREST / Postgres codes meaning "migration 016 isn't applied here". */
function isMissingColumnError(code?: string): boolean {
  return code === "PGRST204" || code === "42703" || code === "42P01";
}

export async function GET() {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/analytics/ai] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await db
      .from("generation_events")
      .select(
        "id, company_id, user_id, event_type, status, model, duration_ms, tokens_input, tokens_output, created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingColumnError(error.code)) {
        console.warn(
          "[admin/analytics/ai] migration 016 pending:",
          error.message,
          error.code
        );
        return NextResponse.json({
          metrics: EMPTY_METRICS,
          recent: [],
          migrationRequired: true,
        });
      }
      console.error("[admin/analytics/ai] Query error:", error.message, error.code);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as EventRow[];
    const metrics = computeAiMetrics(rows, new Date(), WINDOW_DAYS);

    // Newest 10 for the table. Names/emails are resolved with two batched
    // lookups keyed by the ids in this page only — never one query per row.
    const recentRows = rows.slice(0, RECENT_LIMIT);

    const userIds = [...new Set(recentRows.map((r) => r.user_id).filter((v): v is string => !!v))];
    const companyIds = [...new Set(recentRows.map((r) => r.company_id).filter((v): v is string => !!v))];

    const [profilesRes, companiesRes] = await Promise.all([
      userIds.length
        ? db.from("profiles").select("id, email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length
        ? db.from("companies").select("id, name").in("id", companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesRes.error) {
      console.error("[admin/analytics/ai] Profile lookup failed:", profilesRes.error.message);
    }
    if (companiesRes.error) {
      console.error("[admin/analytics/ai] Company lookup failed:", companiesRes.error.message);
    }

    const emailById = new Map<string, string | null>(
      ((profilesRes.data ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email])
    );
    const nameById = new Map<string, string | null>(
      ((companiesRes.data ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name])
    );

    return NextResponse.json({
      metrics,
      recent: recentRows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        eventType: r.event_type,
        status: r.status,
        model: r.model,
        durationMs: r.duration_ms,
        tokensInput: r.tokens_input,
        tokensOutput: r.tokens_output,
        userEmail: r.user_id ? emailById.get(r.user_id) ?? null : null,
        companyName: r.company_id ? nameById.get(r.company_id) ?? null : null,
      })),
      migrationRequired: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/analytics/ai] Error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
