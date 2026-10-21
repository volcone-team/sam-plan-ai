import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
// The 23505 reading already exists and is already tested; reused so the two
// paths cannot drift on what a unique violation means. `webhook-logic` is pure
// (it imports only `plan-change`), so this costs nothing at import time —
// `outbox.ts` imports it for the same reason.
import { interpretClaim } from "@/lib/billing/webhook-logic";
import { describeGhlRowStatus } from "@/lib/ghl/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ghl/retry — put `failed` rows back in the queue.
 *
 * ITS OWN ROUTE, NOT FOLDED INTO /drain. The drain delivers what is already
 * due and is safe to press at any time; this REWRITES TERMINAL ROWS, which is
 * the one admin action here that changes history rather than acting on it. One
 * POST that did both would have to return two unrelated result shapes, could
 * not be granted or audited separately, and would make the obvious operator
 * move — "press drain again and see" — silently resurrect rows that were given
 * up on for a reason. They are also used in that order: retry, then drain.
 *
 * SCOPE: one row by `id`, or every failed row when no id is given.
 *
 * BOTH, because the two real situations are different. A revoked token or an
 * expired integration fails EVERYTHING in the queue, and the operator's action
 * after fixing it is "retry the lot" — making them click 40 rows would
 * guarantee they miss some. A single row matters for the other case: one
 * contact with a malformed address, or one event an operator wants to probe
 * without re-sending the other 39. The bulk form is capped (see below) so a
 * single request cannot pick up an unbounded backlog.
 *
 * WHAT IT WILL NOT TOUCH:
 *   - `skipped`. 044: TERMINAL AND LEGITIMATE, not a failure. The contact is
 *     not in that sub-account, which is an answer, and retrying it would
 *     re-ask a question already answered — forever, since nothing about the
 *     row can change the outcome.
 *   - `pending`. Already queued; resetting `attempts` would hand it a fresh
 *     budget mid-backoff and, worse, clobber a lease a worker is holding right
 *     now.
 *   - `delivered`. It happened. Re-sending it is a job for a new event, not
 *     for a rewrite of the record that it already went out.
 */

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The most rows one bulk request will move.
 *
 * Generous relative to `GHL_DRAIN_BATCH_SIZE` (25) because requeueing is a
 * local UPDATE and costs GHL nothing — the rate limit is spent later, by the
 * drain, 25 at a time. The cap is here so one click cannot turn a month of
 * accumulated failures into a single unbounded loop inside one serverless
 * invocation; the response reports what is left so the operator can press
 * again.
 */
const RETRY_MAX_ROWS = 200;

interface FailedRow {
  id: string;
  dedupe_key: string | null;
}

export async function POST(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // An empty body is the bulk form; the panel's "Retry all failed" button
      // sends `{}`, and curl with no -d sends nothing at all.
      body = {};
    }
    const rawId = (body as { id?: unknown })?.id;
    if (rawId !== undefined && typeof rawId !== "string") {
      return NextResponse.json(
        { error: "id", message: "`id` must be a row id string, or be omitted to retry all." },
        { status: 400 }
      );
    }
    const targetId = typeof rawId === "string" && rawId.trim() !== "" ? rawId.trim() : null;

    const db = serviceClient();

    /*
     * ROWS ARE SELECTED FIRST AND UPDATED ONE AT A TIME, which looks wasteful
     * next to a single `update().eq("status","failed")` and is the entire point
     * of this route — see the 23505 note below. A bulk UPDATE is one statement:
     * one conflicting row aborts it and NOTHING is requeued, so the common case
     * (an old failed row whose intent a newer row already covers) would make
     * the button appear broken.
     */
    let selectQuery = db
      .from("ghl_events")
      .select("id, dedupe_key")
      .eq("status", "failed")
      // Oldest first, matching the drain's FIFO so the queue comes back in the
      // order it went in.
      .order("created_at", { ascending: true })
      .limit(RETRY_MAX_ROWS);

    if (targetId) selectQuery = selectQuery.eq("id", targetId);

    const { data, error: readError } = await selectQuery;
    if (readError) {
      console.error("[admin/ghl/retry] read failed:", readError.message);
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }

    const rows = (data ?? []) as FailedRow[];

    /*
     * A NAMED ROW THAT IS NOT FAILED GETS AN EXPLANATION, NOT A SILENT ZERO.
     * The likeliest reason is that it is `skipped`, and an operator who clicked
     * retry on it has the wrong model of what skipped means; saying so here is
     * cheaper than them clicking it again next week.
     */
    if (targetId && rows.length === 0) {
      const { data: actual } = await db
        .from("ghl_events")
        .select("status")
        .eq("id", targetId)
        .maybeSingle();

      const status = (actual as { status?: string | null } | null)?.status ?? null;
      if (!status) {
        return NextResponse.json(
          { error: "not_found", message: "No outbox row with that id." },
          { status: 404 }
        );
      }
      const described = describeGhlRowStatus(status);
      return NextResponse.json(
        {
          error: "not_failed",
          status,
          message: `That row is ${described.label.toLowerCase()}, not failed. ${described.detail}`,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    let requeued = 0;
    let superseded = 0;
    let unchanged = 0;
    const errors: { id: string; message: string }[] = [];

    for (const row of rows) {
      const { data: updated, error } = await db
        .from("ghl_events")
        .update({
          status: "pending",
          /*
           * `attempts` BACK TO ZERO, so the row gets the full budget again.
           * The point of a retry is that the CAUSE has been fixed; leaving
           * attempts at 5 would mean the next failure is instantly terminal
           * and the operator learns nothing about whether the fix worked.
           */
          attempts: 0,
          // Due immediately. The drain's own backoff takes over from here if
          // it fails again.
          next_attempt_at: nowIso,
          /*
           * `last_error` IS KEPT, NOT CLEARED. It is the only record of why
           * the row failed, and it is the context an operator needs while
           * watching the retry: "pending, and it previously died on a 401" is
           * a readable state, whereas a bare pending row with no history looks
           * like it was never a problem. Nothing stale survives it either —
           * the drain overwrites `last_error` on its next attempt and clears it
           * outright on a real delivery.
           */
        })
        .eq("id", row.id)
        /*
         * STILL FAILED. Between the select and this update the cron could have
         * done nothing to a failed row — but a concurrent operator pressing
         * the same button could, and this guard is what makes the second press
         * a no-op instead of resetting a row the first press has already put
         * back in flight.
         */
        .eq("status", "failed")
        .select("id");

      if (error) {
        /*
         * THE 23505 TRAP, AND WHY IT IS A SUCCESS.
         *
         * 044's dedupe index is UNIQUE on (sub_account, dedupe_key) and
         * PARTIAL over `status IN ('pending','delivered')`. A failed row is
         * OUTSIDE that index — which is precisely why it was allowed to be
         * re-enqueued while it sat there — so moving it back to `pending`
         * RE-ENTERS the index, and if a newer row with the same key is already
         * pending or delivered, Postgres refuses the update with 23505.
         *
         * That refusal means "a newer row already covers this intent". The tag
         * change this row wanted either has happened or is queued to happen,
         * and the correct outcome is to leave this one failed as the historical
         * record of the attempt that did not land. Reporting it as an error
         * would send an operator hunting for a conflict that is actually the
         * system being right — and, worse, would make the bulk button look
         * broken whenever one old row in forty is superseded.
         *
         * `interpretClaim` is the same 23505 reading `outbox.ts` uses for the
         * insert side of this index.
         */
        if (interpretClaim(error.code) === "duplicate") {
          superseded += 1;
          continue;
        }
        errors.push({ id: row.id, message: error.message });
        console.error("[admin/ghl/retry] requeue failed for", row.id, "-", error.message);
        continue;
      }

      const touched = Array.isArray(updated) ? updated.length : updated ? 1 : 0;
      if (touched > 0) requeued += 1;
      else unchanged += 1;
    }

    // How much of a large backlog is still sitting there, so the operator
    // knows whether to press again. Head count: no rows, no emails.
    const { count: failedRemaining } = await db
      .from("ghl_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed");

    await logActivity(
      {
        actorUserId: check.userId,
        action: "ghl_outbox.retried",
        targetType: "ghl_events",
        targetId: targetId,
        targetLabel: targetId ? "single_row" : "all_failed",
        // Counts and a row id. No contact email: this is an audit trail, not a
        // copy of the outbox.
        metadata: {
          scope: targetId ? "row" : "all",
          requeued,
          superseded,
          unchanged,
          errors: errors.length,
        },
      },
      db
    );

    return NextResponse.json({
      scope: targetId ? "row" : "all",
      /** Moved back to pending; the next drain will pick them up. */
      requeued,
      /** A newer row already covers the intent. Success, not an error. */
      superseded,
      /** Someone else requeued them between the read and the write. */
      unchanged,
      /** Still failed after this request, including anything over the cap. */
      failedRemaining: failedRemaining ?? 0,
      /** True when the cap was hit, so the panel can say "press again". */
      capped: rows.length >= RETRY_MAX_ROWS,
      errors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[admin/ghl/retry] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
