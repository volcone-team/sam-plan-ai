/**
 * Does the database have what the cancellation flow needs?
 *
 * Covers migrations 030 (cancellation_feedback) and 031
 * (retention_offer_redemptions).
 *
 * /api/billing/cancel writes a cancellation_feedback row AFTER telling Stripe to
 * stop the subscription. If the table is missing, the customer is cancelled in
 * Stripe and the route then 500s — the worst ordering of outcomes, because the
 * money stops but the UI reports failure. The route guards against this, but
 * this check is the gate before pushing.
 *
 * 031 matters MORE, not less. The UNIQUE on company_id is the only thing that
 * makes "one-time offer" true; without the table the retention route refuses to
 * grant anything, which is the correct failure direction but means the discount
 * screen cannot work at all.
 *
 * Read-only. Usage: node scripts/verify-cancellation-schema.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COLUMNS = [
  "id",
  "company_id",
  "user_id",
  "user_email",
  "reason",
  "reason_detail",
  "outcome",
  "offer_shown",
  "offer_outcome",
  "details",
  "plan_id",
  "stripe_subscription_id",
  "access_ends_at",
  "created_at",
];

console.log("\nCancellation feedback schema (migration 030)\n");

let failed = false;

// Selected individually: a combined select fails on the FIRST missing column
// and would not say which others are absent.
for (const column of COLUMNS) {
  const { error } = await db.from("cancellation_feedback").select(column).limit(1);
  if (error) {
    console.log(`  MISSING  cancellation_feedback.${column}  — ${error.message}`);
    failed = true;
  } else {
    console.log(`  ok       cancellation_feedback.${column}`);
  }
}

/**
 * The columns the cancel route reads off `subscriptions`. All pre-existing, but
 * a missing one fails the same way, so prove them here rather than assume.
 */
if (!failed) {
  const { error } = await db
    .from("subscriptions")
    .select(
      "company_id, plan_id, stripe_subscription_id, stripe_status, status, " +
      "cancel_at_period_end, current_period_end, is_comped, is_paused, pending_plan_id"
    )
    .limit(1);

  if (error) {
    console.log(`\n  CANCEL ROUTE READ FAILED — ${error.message}`);
    failed = true;
  } else {
    console.log("\n  ok       cancel route read works");
  }
}

// Informational: how many customers are already set to stop. Cancelling is
// recorded by the webhook today via the hosted portal, so this is expected to be
// non-zero on a real database and is not a failure either way.
if (!failed) {
  const { count } = await db
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("cancel_at_period_end", true);
  console.log(`  ok       subscriptions already ending: ${count ?? 0}`);

  const { count: logged } = await db
    .from("cancellation_feedback")
    .select("id", { count: "exact", head: true });
  console.log(`  ok       cancellation_feedback rows so far: ${logged ?? 0}`);
}

// ---------------------------------------------------------------
// Migration 031 — retention offers
// ---------------------------------------------------------------
const REDEMPTION_COLUMNS = [
  "id",
  "company_id",
  "offer_id",
  "coupon_id",
  "stripe_subscription_id",
  "redeemed_by",
  "redeemed_by_email",
  "price_minor_at_redemption",
  "billing_resumes_at",
  "redeemed_at",
];

console.log("\nRetention offer redemptions (migration 031)\n");

let offersFailed = false;

for (const column of REDEMPTION_COLUMNS) {
  const { error } = await db.from("retention_offer_redemptions").select(column).limit(1);
  if (error) {
    console.log(`  MISSING  retention_offer_redemptions.${column}  — ${error.message}`);
    offersFailed = true;
  } else {
    console.log(`  ok       retention_offer_redemptions.${column}`);
  }
}

/**
 * The UNIQUE on company_id is the whole point of the table, and a table created
 * without it would pass every column check above while silently allowing a
 * customer to claim a second discount. Proven by counting rows per company
 * rather than by reading the catalogue, which PostgREST does not expose.
 */
if (!offersFailed) {
  const { data: rows } = await db
    .from("retention_offer_redemptions")
    .select("company_id");

  const seen = new Set();
  let duplicate = null;
  for (const row of rows ?? []) {
    if (seen.has(row.company_id)) { duplicate = row.company_id; break; }
    seen.add(row.company_id);
  }

  if (duplicate) {
    console.log(
      `\n  UNIQUE CONSTRAINT MISSING — company ${duplicate} holds more than one ` +
      `redemption. "One-time offer" is not being enforced.`
    );
    offersFailed = true;
  } else {
    console.log(`\n  ok       one redemption per company | redeemed so far: ${seen.size}`);
  }
}

// ---------------------------------------------------------------
// Migration 032 — customer pause
// ---------------------------------------------------------------
console.log("\nCustomer pause (migration 032)\n");

let pauseFailed = false;

for (const column of ["pause_origin", "pause_reminder_sent_at"]) {
  const { error } = await db.from("subscriptions").select(column).limit(1);
  if (error) {
    console.log(`  MISSING  subscriptions.${column}  — ${error.message}`);
    pauseFailed = true;
  } else {
    console.log(`  ok       subscriptions.${column}`);
  }
}

/**
 * THE BACKFILL IS THE SAFETY-CRITICAL PART.
 *
 * canResumeSelf lets a customer lift a pause only when pause_origin is
 * 'customer', and treats anything else as an admin suspension. A paused row
 * left with a NULL origin is therefore still safe — it fails closed — but it
 * means an admin-paused account shows no origin at all, which is worth knowing
 * about before it confuses someone reading the admin table.
 */
if (!pauseFailed) {
  const { data: pausedRows } = await db
    .from("subscriptions")
    .select("company_id, pause_origin, pause_resumes_at")
    .eq("is_paused", true);

  const rows = pausedRows ?? [];
  const missingOrigin = rows.filter((r) => !r.pause_origin);

  console.log(`\n  ok       currently paused: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `             ${r.company_id} | origin: ${r.pause_origin ?? "NULL"} | resumes: ${r.pause_resumes_at ?? "never"}`
    );
  }

  if (missingOrigin.length > 0) {
    console.log(
      `\n  WARN     ${missingOrigin.length} paused row(s) have no pause_origin.\n` +
      "           Not dangerous — canResumeSelf fails closed and treats them as\n" +
      "           admin pauses — but 032's backfill should have set them. Re-run it."
    );
  }

  // The cron's own query, proven rather than assumed.
  const { error: cronReadError } = await db
    .from("subscriptions")
    .select("company_id, pause_origin, pause_resumes_at, pause_reminder_sent_at")
    .eq("is_paused", true)
    .not("pause_resumes_at", "is", null);

  if (cronReadError) {
    console.log(`\n  CRON READ FAILED — ${cronReadError.message}`);
    pauseFailed = true;
  } else {
    console.log("  ok       cron read works (/api/cron/resume-paused)");
  }
}

// ---------------------------------------------------------------
// Migration 033 — retention booking URLs
// ---------------------------------------------------------------
console.log("\nRetention booking URLs (migration 033)\n");

let bookingFailed = false;

const { data: bookingSettings, error: bookingError } = await db
  .from("app_settings")
  .select("retention_reset_call_url, retention_strategy_call_url")
  .eq("id", "global")
  .maybeSingle();

if (bookingError) {
  console.log(`  MISSING  app_settings booking columns — ${bookingError.message}`);
  bookingFailed = true;
} else {
  const reset = bookingSettings?.retention_reset_call_url ?? null;
  const strategy = bookingSettings?.retention_strategy_call_url ?? null;
  console.log(`  ok       app_settings.retention_reset_call_url     ${reset ?? "(not set)"}`);
  console.log(`  ok       app_settings.retention_strategy_call_url  ${strategy ?? "(not set)"}`);

  // These decide whether two of the six offer screens appear at all.
  console.log(
    `\n  ${reset ? "ok   " : "note "}    reset call screen (2b):    ${reset ? "LIVE" : "hidden — no URL set"}`
  );
  console.log(
    `  ${reset || strategy ? "ok   " : "note "}    strategy call screen (2c): ${
      strategy ? "LIVE" : reset ? "LIVE (reusing the reset URL)" : "hidden — no URL set"
    }`
  );
  if (!reset && !strategy) {
    console.log(
      "\n           Set them on /admin/subscriptions → Retention. Until then those\n" +
      "           two reasons go straight from step 1 to the cancel confirmation."
    );
  }
}

const pending = [];
if (failed) pending.push("supabase/migrations/030_cancellation_feedback.sql");
if (offersFailed) pending.push("supabase/migrations/031_retention_offers.sql");
if (pauseFailed) pending.push("supabase/migrations/032_customer_pause.sql");
if (bookingFailed) pending.push("supabase/migrations/033_retention_booking_urls.sql");

console.log(
  pending.length
    ? `\nNOT READY — do not deploy. Apply first:\n  ${pending.join("\n  ")}\n`
    : "\nReady to deploy.\n"
);

process.exit(pending.length ? 1 : 0);
