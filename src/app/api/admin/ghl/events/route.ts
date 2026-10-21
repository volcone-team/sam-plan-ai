import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import {
  GHL_OUTBOX_STATUSES,
  ghlRowErrorText,
  isGhlDryRunRow,
  summariseGhlOutbox,
  type GhlOutboxCounts,
} from "@/lib/ghl/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ghl/events
 *
 * The outbox, for the admin panel: counts by status, and a page of recent rows
 * newest first.
 *
 * SUPER-ADMIN ONLY, like the settings route beside it. `ghl_events` has RLS on
 * with no policies at all (044 argues that at length), so the read uses the
 * service-role client and this check is the only thing standing in front of it.
 *
 * CONTACT EMAIL IS IN THE RESPONSE AND NOT IN THE LOGS. It is the GHL join key
 * and an operator checking "who would be tagged" needs to see it, which is
 * fine on a super-admin screen. Server logs are a different audience with a
 * different retention: nothing here console.logs a row, an email or a count of
 * one, deliberately. The same rule the drain's dry-run line follows in
 * reverse — that one logs an email because its whole output IS the dry run.
 *
 * `skipped` IS NOT AN ERROR. 044 is explicit; `summariseGhlOutbox` is where
 * that is enforced, and it counts `failed` alone as needing attention.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const MIGRATION_REQUIRED = {
  error: "migration_required",
  migration: "044_ghl_outbox",
  message:
    "Migration 044 (044_ghl_outbox.sql) has not been applied to this database " +
    "yet, so there is no outbox to read. Run it in the Supabase SQL editor, " +
    "then reload this page.",
} as const;

/**
 * "That table does not exist."
 *
 * NOT `isMissingColumnError`, which answers the column question: an unapplied
 * 044 means the whole `ghl_events` relation is absent, and Postgres says so
 * with 42P01 while PostgREST says PGRST205. Local to this route because it is
 * the only place in the codebase that reads a table a migration might not have
 * created yet — the settings route reads `app_settings`, which has existed
 * since 020.
 */
function isMissingTableError(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return /relation .* does not exist/i.test(err.message ?? "");
}

function parseInt0(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return n;
}

interface GhlEventRecord {
  id: string;
  created_at: string;
  event_type: string | null;
  company_id: string | null;
  contact_email: string | null;
  tags_add: string[] | null;
  tags_remove: string[] | null;
  status: string | null;
  attempts: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * Counts by status, plus how many pending rows the drain could take right now.
 *
 * HEAD COUNTS, NOT ROWS. `{ count: "exact", head: true }` asks Postgres for
 * the number and transfers no rows at all; counting a fetched page would be
 * wrong (it only sees the page) and counting a fetched table would move every
 * email in the outbox across the wire to produce five integers.
 *
 * FIVE QUERIES IN PARALLEL rather than one GROUP BY, because PostgREST cannot
 * express a group-by aggregate without a database view or an RPC, and both are
 * hand-run migrations. Five head counts against a table whose only selective
 * predicate is already indexed is cheap, and `Promise.all` makes it one round
 * trip's worth of latency.
 */
async function readCounts(
  db: SupabaseClient,
  nowIso: string
): Promise<
  { ok: true; counts: GhlOutboxCounts } | { ok: false; missingTable: boolean; message: string }
> {
  const statusCount = (status: string) =>
    db.from("ghl_events").select("id", { count: "exact", head: true }).eq("status", status);

  const [pending, delivered, failed, skipped, dueNow] = await Promise.all([
    ...GHL_OUTBOX_STATUSES.map((s) => statusCount(s)),
    db
      .from("ghl_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      // The same predicate the drain claims with, so "due now" on the screen
      // and "what the next run will pick up" cannot disagree. A leased row is
      // excluded for free: the lease IS a future next_attempt_at.
      .lte("next_attempt_at", nowIso),
  ]);

  for (const result of [pending, delivered, failed, skipped, dueNow]) {
    if (result.error) {
      return {
        ok: false,
        missingTable: isMissingTableError(result.error),
        message: result.error.message,
      };
    }
  }

  return {
    ok: true,
    counts: {
      pending: pending.count ?? 0,
      delivered: delivered.count ?? 0,
      failed: failed.count ?? 0,
      skipped: skipped.count ?? 0,
      dueNow: dueNow.count ?? 0,
    },
  };
}

export async function GET(request: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt0(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const offset = parseInt0(searchParams.get("offset"), 0);
    const statusFilter = searchParams.get("status");

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const nowIso = new Date().toISOString();
    const counts = await readCounts(db, nowIso);
    if (!counts.ok) {
      if (counts.missingTable) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/ghl/events] count query failed:", counts.message);
      return NextResponse.json({ error: counts.message }, { status: 500 });
    }

    let query = db
      .from("ghl_events")
      .select(
        "id, created_at, event_type, company_id, contact_email, tags_add, tags_remove, status, attempts, last_error, next_attempt_at, delivered_at, payload",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + Math.max(limit, 1) - 1);

    // Only the four statuses 044 allows are honoured, so a stray query param
    // cannot turn the page into an empty table with no explanation.
    if (statusFilter && (GHL_OUTBOX_STATUSES as readonly string[]).includes(statusFilter)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[admin/ghl/events] row query failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as GhlEventRecord[];

    /*
     * ONE BATCHED COMPANY LOOKUP, as /api/admin/companies does for
     * `portal_access_granted_by`: collect the distinct ids off the page, ask
     * once with `.in()`, resolve from a Map. A per-row join would be 25 round
     * trips for a column that repeats.
     *
     * A MISSING NAME IS NOT AN ERROR. 044 cascades `company_id` on company
     * delete, so an unresolved id means the row is person-level
     * (`company_id` null) rather than dangling; either way the panel shows a
     * dash and the row still reads.
     */
    const companyIds = [
      ...new Set(rows.map((r) => r.company_id).filter((v): v is string => typeof v === "string" && !!v)),
    ];
    const { data: companies } = companyIds.length
      ? await db.from("companies").select("id, name").in("id", companyIds)
      : { data: [] as { id: string; name: string | null }[] };
    const companyNameById = new Map(
      ((companies ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name ?? c.id])
    );

    return NextResponse.json({
      counts: counts.counts,
      summary: summariseGhlOutbox(counts.counts),
      entries: rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        eventType: r.event_type,
        companyId: r.company_id,
        companyName: r.company_id ? companyNameById.get(r.company_id) ?? null : null,
        contactEmail: r.contact_email,
        tagsAdd: r.tags_add ?? [],
        tagsRemove: r.tags_remove ?? [],
        status: r.status,
        attempts: r.attempts ?? 0,
        /*
         * NULL ON A DRY-RUN ROW. The drain writes its marker into
         * `last_error` on a row it marks delivered, so the column holds a NOTE
         * there rather than a fault; `ghlRowErrorText` is the one place that
         * distinction is made, so the panel can render this column verbatim.
         */
        lastError: ghlRowErrorText(r),
        nextAttemptAt: r.next_attempt_at,
        deliveredAt: r.delivered_at,
        /*
         * RESOLVED HERE, AND `payload` IS NOT SHIPPED. The dry-run marker
         * lives in two places (see `isGhlDryRunRow`) and the panel must not
         * have to know that; and the payload is free-form producer context
         * that 044 warns is readable by anyone with backup access, so there is
         * no reason to put it in a browser as well.
         */
        dryRun: isGhlDryRunRow(r),
      })),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/ghl/events] error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
