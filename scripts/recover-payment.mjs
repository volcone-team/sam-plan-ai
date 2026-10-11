/**
 * Recover a payment that Stripe took but no webhook recorded.
 *
 * Webhook delivery is never guaranteed — it can be late, fail signature
 * validation, or target an endpoint that is down (Stripe can only deliver to a
 * public URL, so never to localhost). Stripe is the authority on what was
 * actually bought, so this reads from there and writes the subscription row.
 *
 * Same logic the in-app reconcile uses, available from the CLI for an account
 * that cannot reach it — e.g. one stranded on the purchase screen.
 *
 * DRY RUN BY DEFAULT.
 *   node scripts/recover-payment.mjs <companyId>
 *   node scripts/recover-payment.mjs <companyId> --apply
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const companyId = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!companyId) {
  console.error("\nUsage: node scripts/recover-payment.mjs <companyId> [--apply]\n");
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(key);

/**
 * `stripe_mode` is a FIXED TAG, always the string "live", and carries no
 * meaning — see STRIPE_MODE_TAG in lib/billing/stripe-client.ts. It exists
 * only to satisfy unique constraints on billing_invoices and
 * stripe_webhook_events.
 *
 * Writing a real "test"/"live" value here would make every lookup that filters
 * on stripe_mode miss the row, so the account would look unsubscribed again.
 */
const MODE_TAG = "live";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: row } = await db
  .from("subscriptions")
  .select("id, stripe_customer_id, stripe_subscription_id, stripe_status, status")
  .eq("company_id", companyId)
  .maybeSingle();

if (!row) {
  console.error(`\nNo subscription row for company ${companyId}\n`);
  process.exit(1);
}

console.log(`\nCompany ${companyId}  (stripe_mode tag: ${MODE_TAG})`);
console.log(`\n  local : status=${row.status} stripe_status=${row.stripe_status ?? "null"} sub=${row.stripe_subscription_id ?? "null"}`);

if (!row.stripe_customer_id) {
  console.error("\n  No stripe_customer_id — nothing to reconcile against.\n");
  process.exit(1);
}

const subs = await stripe.subscriptions.list({
  customer: row.stripe_customer_id,
  status: "all",
  limit: 10,
});

const LIVE = ["active", "trialing", "past_due"];
// Prefer a live subscription; fall back to the newest so a cancellation is
// reflected rather than leaving stale access in place.
const live = subs.data.find((s) => LIVE.includes(s.status));
const sub = live ?? subs.data.sort((a, b) => b.created - a.created)[0] ?? null;

if (!sub) {
  console.log("\n  Stripe has no subscription for this customer. Nothing to recover.\n");
  process.exit(0);
}

const item = sub.items.data[0];
const priceId = item?.price?.id ?? null;

// Plan from metadata first, then the price. NOT filtered on is_current: a
// grandfathered subscriber sits on a superseded price.
let planId = sub.metadata?.plan_id ?? null;
if (!planId && priceId) {
  const { data: priceRow } = await db
    .from("stripe_prices")
    .select("plan_id")
    .eq("stripe_mode", MODE_TAG)
    .eq("stripe_price_id", priceId)
    .maybeSingle();
  planId = priceRow?.plan_id ?? null;
}

const { data: plan } = planId
  ? await db.from("subscription_plans").select("name").eq("id", planId).maybeSingle()
  : { data: null };

const interval = item?.price?.recurring?.interval;
const billingCycle = interval === "year" ? "annual" : "monthly";

const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
const periodStart = item?.current_period_start ?? sub.current_period_start ?? null;

console.log(`  stripe: ${sub.id} status=${sub.status} plan=${plan?.name ?? planId ?? "unknown"} cycle=${billingCycle}`);

const patch = {
  stripe_subscription_id: sub.id,
  stripe_customer_id: row.stripe_customer_id,
  stripe_status: sub.status,
  stripe_price_id: priceId,
  stripe_mode: MODE_TAG,
  status: LIVE.includes(sub.status) ? "active" : "cancelled",
  plan_id: planId,
  billing_cycle: billingCycle,
  current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
  current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  cancel_at_period_end: sub.cancel_at_period_end,
  // A completed purchase ends any trial: they are a paying customer now.
  is_trial_active: false,
  past_due_since: sub.status === "past_due" ? new Date().toISOString() : null,
  updated_at: new Date().toISOString(),
};

console.log("\n  would write:");
for (const [k, v] of Object.entries(patch)) {
  if (k === "updated_at") continue;
  console.log(`    ${k.padEnd(24)} ${v ?? "null"}`);
}

if (!APPLY) {
  console.log("\n  Dry run. Re-run with --apply to write it.\n");
  process.exit(0);
}

const { error } = await db
  .from("subscriptions")
  .update(patch)
  .eq("company_id", companyId);

if (error) {
  console.error(`\n  FAILED: ${error.message}\n`);
  process.exit(1);
}

console.log("\n  Written. The account now has the plan it paid for.\n");
