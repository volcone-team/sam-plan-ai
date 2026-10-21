import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createGhlClient } from "@/lib/ghl/client";
import { loadGhlConfig, describeGhlConfig } from "@/lib/ghl/config";
import { drainGhlOutbox, GHL_DRAIN_BATCH_SIZE } from "@/lib/ghl/drain";

// Node runtime: uses the service-role key, same as the other two crons.
export const runtime = "nodejs";
// Never cache: this endpoint writes and sends on every invocation.
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/ghl-outbox
 *
 * Delivers one batch of `ghl_events` (migration 044). All of the decision
 * making — claiming, backoff, outcome classification — is in
 * `src/lib/ghl/drain.ts`, where it is unit tested with a fake client. This
 * file is auth, I/O construction and a JSON summary, deliberately thin.
 *
 * NOT ON A SCHEDULE ANY MORE — MANUAL AND EXTERNAL ONLY. This had a Vercel
 * cron entry running every ten minutes; the owner's account is Hobby, which
 * allows two cron jobs and daily expressions only, so that entry failed the
 * deploy outright. It has been removed from `vercel.json` and the route kept, because
 * it is still the right thing to curl by hand and the right thing to point an
 * external scheduler (GitHub Actions, cron-job.org, an upgraded Vercel plan)
 * at. Routine delivery now happens two other ways: opportunistically after
 * every enqueue (`scheduleGhlDrain`, via `after()`), and as a daily safety-net
 * batch at the end of /api/cron/resume-paused.
 *
 * It stays under `/api/cron/` deliberately: the path prefix is what makes it
 * public in the middleware, and renaming it would put it behind the session
 * gate with no one to authenticate.
 *
 * Authorises via `Authorization: Bearer ${CRON_SECRET}`, matching
 * /api/cron/initiative-reminders and /api/cron/resume-paused. An unset secret
 * means every request is unauthorised, and a failure returns 401 with no body
 * so the response discloses nothing about the queue.
 *
 * ALREADY PUBLIC IN THE MIDDLEWARE, and it has to be: `isPublicApiRoute` in
 * src/lib/supabase/middleware.ts matches `/api/cron/` by prefix, so this route
 * is exempt from the session gate, the 2FA gate and the lockout gate the
 * moment it exists. No middleware change is needed or wanted — the Stripe
 * webhook's absence from that list was a production outage, and the lesson
 * cuts the other way too: these routes carry their own authorization and must
 * reach their handler to apply it.
 *
 * SAFE TO RUN CONCURRENTLY with itself and with a manual admin trigger. Rows
 * are claimed under a lease, so an overlapping invocation loses the race and
 * reports `leaseLost` rather than double-delivering.
 *
 * Idempotent in the way that matters: every GHL call the drain makes is
 * idempotent (upsert by email, add or remove a named tag), so a re-run after a
 * killed invocation re-sends at worst a request that changes nothing.
 */
function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const db = serviceClient();

    /*
     * ONE SETTINGS READ, AND IT FAILS CLOSED. `loadGhlConfig` resolves the two
     * switches and the two credentials into a single answer and never throws;
     * anything uncertain comes back as a status the drain declines to work on.
     */
    const config = await loadGhlConfig(db);

    /*
     * The client is built ONLY on a live config, because only a live config
     * carries credentials — a dry run has none by design, which is what makes
     * it impossible for a dry run to write. Passing null is the correct input
     * for every non-live status.
     */
    const client =
      config.status === "live" ? createGhlClient(config.credentials) : null;

    const summary = await drainGhlOutbox({ db, config, client });

    console.log(
      "[cron/ghl-outbox]",
      JSON.stringify({
        ...summary,
        status: config.status,
        batchSize: GHL_DRAIN_BATCH_SIZE,
      })
    );

    // `describeGhlConfig` is credential-free by contract, so it is safe in a
    // response body and tells an operator hitting this by hand why nothing
    // moved.
    return NextResponse.json({ ...summary, status: config.status, config: describeGhlConfig(config) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[cron/ghl-outbox] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
