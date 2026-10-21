import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGhlClient } from "@/lib/ghl/client";
import { ghlIsOn, loadGhlConfig } from "@/lib/ghl/config";
import { drainGhlOutbox } from "@/lib/ghl/drain";

/**
 * Delivering the outbox without a frequent cron.
 *
 * WHY THIS MODULE EXISTS. The outbox used to be drained by its own Vercel cron
 * every ten minutes. The owner's account is Hobby, which allows at most two
 * cron jobs and only DAILY schedules, so that entry could not deploy — the
 * build fails outright on the expression. A once-a-day drain would deploy and
 * would be bad product: a buyer tag arriving up to 24 hours after someone pays
 * means the welcome sequence fires a day late.
 *
 * So delivery moved to where the work is created. `enqueueGhlEvent` schedules
 * a small drain with `after()`, which runs the callback once the response has
 * already been sent — the customer waits for nothing, and the tag is usually
 * in the client's CRM within a second or two of the event that caused it.
 *
 * THREE PATHS TO DELIVERY, AND THIS IS ONLY THE FAST ONE:
 *
 *   1. here — opportunistic, immediately after the request that enqueued;
 *   2. the daily `/api/cron/resume-paused` run, which drains a full batch last
 *      of all (the safety net for rows that failed and backed off, rows
 *      enqueued while the integration was mid-configuration, and retries);
 *   3. "Run drain now" on the admin screen.
 *
 * That redundancy is what licenses the error handling below to swallow
 * everything: A FAILURE HERE COSTS LATENCY, NOT DELIVERY. Nothing is lost, it
 * just arrives on the cron's schedule instead.
 *
 * NEVER THROWS, AND IS SAFE OUTSIDE A REQUEST. `after()` throws when there is
 * no request context — which is exactly the situation in a unit test, in a
 * `scripts/` one-off, and in the cron drain itself (whose rows are enqueued by
 * a producer it calls directly). Both the `after()` call AND the callback body
 * are wrapped, because they fail in different places at different times: the
 * former synchronously inside the caller's `try`, the latter long after the
 * response, where an unhandled rejection is the platform's problem rather than
 * ours.
 */

/**
 * How many rows the opportunistic drain claims.
 *
 * FOUR, AND IT IS A TIME BUDGET, NOT A THROUGHPUT CHOICE. `after` runs inside
 * the route's max duration, and `maxDuration` is not raised anywhere in this
 * app (Hobby caps it, and raising it is the owner's call), so the whole
 * callback shares a 10-second function window with the request that scheduled
 * it. The cron's `GHL_DRAIN_BATCH_SIZE` of 25 is sized against GHL's rate
 * limit, not against a 10-second clock: at up to three calls per row
 * (upsert, add tags, remove tags) with a 10s client timeout each, 25 rows can
 * take minutes and would be killed somewhere in the middle.
 *
 * The arithmetic at four: 12 calls worst case. A healthy GHL call is a few
 * hundred milliseconds, so a typical batch is under two seconds and a slow one
 * still has room before the window closes. Twelve calls is also negligible
 * against the documented 100-per-10-seconds ceiling, so a burst of enqueues
 * (the Stripe webhook writes up to three events for one payment) cannot
 * squeeze out the cron's full batch running at the same moment.
 *
 * AND BEING KILLED MID-BATCH IS HARMLESS ANYWAY, which is the real reason a
 * small number is safe rather than merely cautious. Rows are LEASED, not
 * consumed: `claimGhlEventRow` pushes `next_attempt_at` five minutes out, so a
 * row whose delivery was cut short becomes claimable again shortly afterwards
 * with its attempt already counted. Worst case is a re-run of idempotent calls.
 */
export const GHL_AFTER_DRAIN_BATCH_SIZE = 4;

/**
 * Drain a few rows once the current response has been sent.
 *
 * `db` must be the service-role client the caller already holds — reused
 * rather than rebuilt, and captured by the closure so the callback needs no
 * request-scoped state of its own (it must not read `cookies()` or `headers()`,
 * and it does not).
 *
 * Returns nothing and reports nothing: the caller has already returned by the
 * time this runs, so there is no one to report to. The log line is the record.
 */
export function scheduleGhlDrain(db: SupabaseClient): void {
  try {
    after(async () => {
      try {
        const config = await loadGhlConfig(db);

        /*
         * Switched off between the enqueue and now — a narrow race, since an
         * off integration never enqueues in the first place. Returned early
         * so the common "off" case costs one settings read rather than an
         * outbox query the drain would halt on regardless.
         */
        if (!ghlIsOn(config)) return;

        /*
         * Built ONLY on a live config, because only a live config carries
         * credentials; a dry run has none by design, and `null` is the correct
         * input for every other status. Same construction as
         * /api/cron/ghl-outbox — deliberately, so the two paths cannot drift
         * on what a dry run is allowed to do.
         */
        const client =
          config.status === "live" ? createGhlClient(config.credentials) : null;

        const summary = await drainGhlOutbox({
          db,
          config,
          client,
          batchSize: GHL_AFTER_DRAIN_BATCH_SIZE,
        });

        // Only when something happened. An enqueue on a quiet queue would
        // otherwise log a row of zeros on every signup and payment.
        if (summary.claimed > 0 || summary.errors.length > 0) {
          console.log(
            "[ghl/after-drain]",
            JSON.stringify({ ...summary, status: config.status })
          );
        }
      } catch (err: unknown) {
        /*
         * `drainGhlOutbox` documents that it never throws, so reaching here
         * means something further out broke (a Supabase client that throws on
         * construction of a query, an import failure). Swallowed: this runs
         * after the response, so throwing would surface as an unhandled
         * rejection in the platform log and still deliver nothing. The daily
         * cron picks the rows up.
         */
        console.error(
          "[ghl/after-drain] drain threw, leaving the rows for the daily cron:",
          err instanceof Error ? err.message : String(err)
        );
      }
    });
  } catch {
    /*
     * NO REQUEST CONTEXT. `after()` throws synchronously when called outside a
     * request — in a test, in a script, and in the cron drain's own producers.
     * That is an expected, uninteresting condition rather than a fault, so it
     * is not even logged: the caller is a producer whose whole contract is to
     * never fail for a CRM reason, and the rows are already safely in the
     * outbox for the cron to collect.
     */
  }
}
