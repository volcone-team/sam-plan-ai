import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { STRIPE_MODE_TAG, loadBillingConfig } from "@/lib/billing/stripe-client";
import {
  pauseHasElapsed,
  shouldSendPauseReminder,
  PAUSE_REMINDER_LEAD_DAYS,
} from "@/lib/billing/pause";
import { formatAccessDate } from "@/lib/billing/cancellation";
import { sendPauseEndingSoonEmail } from "@/lib/mailgun";
import { logActivity } from "@/lib/activity-log";
import { getAppUrl } from "@/lib/app-url";

// Node runtime: uses the service-role key.
export const runtime = "nodejs";
// Never cache: this endpoint writes and sends on every invocation.
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/resume-paused
 *
 * Daily housekeeping for paused subscriptions. Two jobs:
 *
 *   1. CLEAR ELAPSED PAUSES. `pause_resumes_at` is handed to Stripe as
 *      `pause_collection.resumes_at`, so Stripe starts charging again by itself
 *      when that moment arrives. Nothing used to clear `is_paused`, which left
 *      the customer billed AND locked out indefinitely. evaluateAccess now
 *      treats an elapsed date as unpaused so nobody is stranded between runs,
 *      but the flag still has to be tidied or the admin table, the paused page
 *      and every pause query keep describing a pause that has ended.
 *
 *   2. SEND THE WEEK-AHEAD WARNING. The pause screen promises in writing:
 *      "we'll email you a week before billing restarts". A charge arriving
 *      unannounced weeks after the customer last thought about us is a dispute
 *      waiting to happen — and the charge being legitimate makes it worse.
 *
 * ONLY TOUCHES CUSTOMER PAUSES FOR THE REMINDER. An admin suspension is not
 * something to send cheerful "billing restarts soon" mail about. It DOES clear
 * elapsed admin pauses, because an admin who set a resume date asked for
 * exactly that and Stripe has already acted on it.
 *
 * Authorises via `Authorization: Bearer ${CRON_SECRET}`, matching
 * /api/cron/initiative-reminders. An unset secret means every request is
 * unauthorised.
 *
 * Idempotent. Runs more than once a day are harmless: elapsed pauses are
 * already cleared, and `pause_reminder_sent_at` stops a second email.
 */

interface PausedRow {
  id: string;
  company_id: string;
  stripe_subscription_id: string | null;
  stripe_mode: string | null;
  stripe_price_id: string | null;
  plan_id: string | null;
  is_paused: boolean | null;
  pause_origin: string | null;
  pause_resumes_at: string | null;
  pause_reminder_sent_at: string | null;
}

interface RunSummary {
  examined: number;
  resumed: string[];
  remindersSent: string[];
  /** Rows we meant to act on but could not. Needs a human. */
  failures: { companyId: string; step: string; message: string }[];
  skipped: string;
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  const summary: RunSummary = {
    examined: 0,
    resumed: [],
    remindersSent: [],
    failures: [],
    skipped: "",
  };

  try {
    const db = serviceClient();

    /**
     * Billing switched off globally means this deployment is not charging
     * anyone, so there is no pause to lift and no restart to warn about.
     * Matching evaluateAccess, where the master switch outranks everything.
     */
    const config = await loadBillingConfig(db);
    if (!config.stripeEnabled) {
      summary.skipped = "billing_disabled";
      console.log("[cron/resume-paused] Billing disabled — nothing to do.");
      return NextResponse.json(summary);
    }

    // Only paused rows with an end date. An open-ended pause never elapses and
    // has nothing to warn about. Uses the partial index from migration 032.
    const { data: rows, error } = await db
      .from("subscriptions")
      .select(
        "id, company_id, stripe_subscription_id, stripe_mode, stripe_price_id, " +
        "plan_id, is_paused, pause_origin, pause_resumes_at, pause_reminder_sent_at"
      )
      .eq("is_paused", true)
      .not("pause_resumes_at", "is", null);

    if (error) {
      console.error("[cron/resume-paused] Could not read subscriptions:", error.message);
      return NextResponse.json({ ...summary, error: error.message }, { status: 500 });
    }

    // Via `unknown`: supabase-js cannot infer a row shape from a concatenated
    // select string and falls back to a union including an error type.
    const paused = (rows ?? []) as unknown as PausedRow[];
    summary.examined = paused.length;
    const now = Date.now();

    for (const row of paused) {
      // ---- 1. Pause has run its course: clear the flag ----
      if (pauseHasElapsed({
        isPaused: true,
        pauseResumesAt: row.pause_resumes_at,
        now,
      })) {
        /**
         * STRIPE IS NOT CALLED HERE, deliberately. It resumed collection itself
         * at `resumes_at` — that is what the parameter means. Sending
         * `pause_collection: null` would be a no-op at best, and at worst would
         * clobber a NEW pause an admin applied in the meantime.
         */
        const { error: clearError } = await db
          .from("subscriptions")
          .update({
            is_paused: false,
            paused_at: null,
            paused_by: null,
            pause_reason: null,
            pause_resumes_at: null,
            pause_origin: null,
            pause_reminder_sent_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", row.company_id)
          // Guard against a race with a customer resuming manually in the same
          // moment: only clear it if it is still paused.
          .eq("is_paused", true);

        if (clearError) {
          summary.failures.push({
            companyId: row.company_id,
            step: "clear_pause",
            message: clearError.message,
          });
          console.error(
            "[cron/resume-paused] Could not clear pause for", row.company_id,
            "—", clearError.message
          );
          continue;
        }

        summary.resumed.push(row.company_id);

        await logActivity({
          companyId: row.company_id,
          actorUserId: null,
          actorEmail: null,
          action: "billing.resumed",
          targetType: "subscription",
          targetId: row.id,
          metadata: {
            origin: "cron",
            previousPauseOrigin: row.pause_origin,
            scheduledResumeAt: row.pause_resumes_at,
          },
        });

        continue;
      }

      // ---- 2. Still paused, but ending soon: warn them ----
      const isCustomerPause = row.pause_origin === "customer";
      if (
        isCustomerPause &&
        shouldSendPauseReminder({
          isPaused: true,
          pauseResumesAt: row.pause_resumes_at,
          reminderSentAt: row.pause_reminder_sent_at,
          now,
        })
      ) {
        try {
          // The owner is who gets billed, so the owner is who is warned.
          const { data: owner } = await db
            .from("profiles")
            .select("email, first_name")
            .eq("company_id", row.company_id)
            .eq("role", "owner")
            .limit(1)
            .maybeSingle();

          const recipient = owner as { email?: string; first_name?: string } | null;
          if (!recipient?.email) {
            summary.failures.push({
              companyId: row.company_id,
              step: "reminder_no_owner",
              message: "No owner email on the company",
            });
            continue;
          }

          const [{ data: plan }, { data: priceRow }] = await Promise.all([
            row.plan_id
              ? db.from("subscription_plans").select("name").eq("id", row.plan_id).maybeSingle()
              : Promise.resolve({ data: null }),
            row.stripe_price_id
              ? db
                  .from("stripe_prices")
                  .select("unit_amount, currency")
                  .eq("stripe_mode", STRIPE_MODE_TAG)
                  .eq("stripe_price_id", row.stripe_price_id)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
          ]);

          const price = priceRow as { unit_amount: number; currency: string } | null;
          const symbol = (price?.currency ?? "usd").toUpperCase() === "USD" ? "$" : "";
          const amount =
            typeof price?.unit_amount === "number"
              ? `${symbol}${(price.unit_amount / 100).toLocaleString("en-US", {
                  minimumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
                  maximumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
                })}`
              : null;

          const sent = await sendPauseEndingSoonEmail(recipient.email, {
            firstName: recipient.first_name ?? null,
            planName: (plan as { name?: string } | null)?.name ?? null,
            restartsOn: formatAccessDate(row.pause_resumes_at),
            price: amount,
            settingsUrl: `${getAppUrl()}/settings`,
          });

          if (!sent) {
            /**
             * NOT marked as sent, so tomorrow's run tries again.
             * shouldSendPauseReminder has no lower bound precisely so a late
             * reminder is still possible — better late than a silent charge.
             */
            summary.failures.push({
              companyId: row.company_id,
              step: "reminder_send",
              message: "Mailgun returned no message id",
            });
            continue;
          }

          const { error: markError } = await db
            .from("subscriptions")
            .update({ pause_reminder_sent_at: new Date().toISOString() })
            .eq("company_id", row.company_id);

          if (markError) {
            // Sent but unrecorded: the customer may get a duplicate tomorrow.
            // Logged rather than retried, because re-sending is the lesser harm.
            summary.failures.push({
              companyId: row.company_id,
              step: "reminder_mark",
              message: markError.message,
            });
          }

          summary.remindersSent.push(row.company_id);
        } catch (err) {
          summary.failures.push({
            companyId: row.company_id,
            step: "reminder",
            message: errMessage(err),
          });
          console.error(
            "[cron/resume-paused] Reminder failed for", row.company_id,
            "—", errMessage(err)
          );
        }
      }
    }

    console.log(
      "[cron/resume-paused]",
      JSON.stringify({ ...summary, leadDays: PAUSE_REMINDER_LEAD_DAYS })
    );
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[cron/resume-paused] Error:", message);
    return NextResponse.json({ ...summary, error: message }, { status: 500 });
  }
}
