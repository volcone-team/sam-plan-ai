import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { createGhlClient } from "@/lib/ghl/client";
import { loadGhlConfig, describeGhlConfig } from "@/lib/ghl/config";
import { drainGhlOutbox, GHL_DRAIN_BATCH_SIZE } from "@/lib/ghl/drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ghl/drain — run one batch now.
 *
 * THE SAME WORK AS THE CRON, NOT A SECOND IMPLEMENTATION. This is a copy of
 * /api/cron/ghl-outbox's body with the Bearer check swapped for
 * `requireSuperAdmin`: one settings read, build a client only on a live
 * config, hand everything to `drainGhlOutbox`. Every decision — claiming,
 * backoff, the outcome matrix — stays in `src/lib/ghl/drain.ts` where it is
 * unit tested with a fake client. A manual trigger that drained "slightly
 * differently" would be a second policy to keep in step, and the one place an
 * operator uses it is the moment they most need it to behave exactly like the
 * scheduled run they are debugging.
 *
 * SAFE TO RUN WHILE THE CRON IS RUNNING. `claimGhlEventRow` turns the claim
 * into a lease — bump `attempts`, push `next_attempt_at` five minutes out,
 * conditional on the row still being pending and still due — and Postgres
 * serialises the two UPDATEs, so whichever worker loses the race gets zero
 * rows back and does not deliver. The loser counts the row in `leaseLost`.
 *
 * WHICH IS WHY `leaseLost` IS IN THE RESPONSE AND ON THE SCREEN. The confusing
 * outcome of pressing this button is "claimed 0, delivered 0" while the panel
 * clearly shows twelve rows due, and the answer is almost always "the cron
 * took them a second ago". Without that number an operator presses the button
 * again, and then starts looking for a bug that is not there.
 *
 * POST, NOT GET: this writes, and it spends the client's GHL rate-limit
 * budget. The cron is a GET only because Vercel's scheduler sends one.
 */

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = serviceClient();

    // Fails closed and never throws; anything uncertain comes back as a status
    // the drain declines to work on, and `halted` says which.
    const config = await loadGhlConfig(db);

    /*
     * The client is built ONLY on a live config, because only a live config
     * carries credentials — a dry run has none by design, which is what makes
     * it impossible for a dry run to write. Passing null is the correct input
     * for every non-live status.
     */
    const client = config.status === "live" ? createGhlClient(config.credentials) : null;

    const summary = await drainGhlOutbox({ db, config, client });

    /*
     * AUDITED, UNLIKE THE CRON. A scheduled drain is the system doing its job;
     * a manual one is a person deciding to push tags into the client's CRM
     * outside the schedule, and "who ran it, when, and what moved" is exactly
     * the question that gets asked afterwards. Counts only — no email, no row
     * id, nothing that would put customer PII in the audit trail.
     */
    await logActivity(
      {
        actorUserId: check.userId,
        action: "ghl_outbox.drained",
        targetType: "ghl_events",
        targetId: null,
        targetLabel: "manual_drain",
        metadata: {
          status: config.status,
          claimed: summary.claimed,
          delivered: summary.delivered,
          skipped: summary.skipped,
          failed: summary.failed,
          retrying: summary.retrying,
          leaseLost: summary.leaseLost,
          ...(summary.halted ? { halted: summary.halted } : {}),
        },
      },
      db
    );

    // No row-level logging: the drain already logs what it needs to, and this
    // route's summary is counts. `describeGhlConfig` is credential-free by
    // contract, so it is safe in the body and tells an operator why nothing
    // moved when nothing moved.
    return NextResponse.json({
      ...summary,
      status: config.status,
      config: describeGhlConfig(config),
      batchSize: GHL_DRAIN_BATCH_SIZE,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[admin/ghl/drain] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
