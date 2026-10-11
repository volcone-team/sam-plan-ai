/**
 * Cancel Stripe subscriptions that belong to no account in this database.
 *
 * Deleting a user or company used to leave Stripe untouched, so the customer
 * and their subscription survived and kept billing. `lib/billing/cancel-on-delete.ts`
 * stops new orphans; this clears the ones already there.
 *
 * DRY RUN BY DEFAULT. Nothing is cancelled unless --apply is passed, because
 * cancelling the wrong subscription means cutting off a paying customer.
 *
 *   node scripts/cancel-stripe-orphans.mjs           # report only
 *   node scripts/cancel-stripe-orphans.mjs --apply   # actually cancel
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");

const key = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("No Stripe secret key in .env.local");
  process.exit(1);
}

/**
 * Refuse to run against a live key without an explicit extra flag.
 *
 * The cost of a mistake here is cancelling real customers' subscriptions, so
 * the live account needs more than one opt-in.
 */
const isLive = key.startsWith("sk_live_");
if (isLive && !process.argv.includes("--i-understand-this-is-live")) {
  console.error(
    "\nThis is a LIVE Stripe key. Re-run with --i-understand-this-is-live\n" +
      "if you genuinely mean to cancel live subscriptions.\n"
  );
  process.exit(1);
}

const stripe = new Stripe(key);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Everything the database still knows about.
 *
 * Both the customer ids AND the subscription ids: a subscription is only an
 * orphan if NEITHER is referenced, which keeps a live account safe even if one
 * of its two links was never written.
 */
const { data: subs } = await db
  .from("subscriptions")
  .select("company_id, stripe_customer_id, stripe_subscription_id");

const knownCustomers = new Set(
  (subs ?? []).map((s) => s.stripe_customer_id).filter(Boolean)
);
const knownSubscriptions = new Set(
  (subs ?? []).map((s) => s.stripe_subscription_id).filter(Boolean)
);

console.log(`\nLocal rows: ${(subs ?? []).length}`);
console.log(`Known Stripe customers: ${knownCustomers.size}`);
console.log(`Known Stripe subscriptions: ${knownSubscriptions.size}`);
console.log(`Mode: ${isLive ? "LIVE" : "test"} | ${APPLY ? "APPLY" : "dry run"}\n`);
console.log("=".repeat(66));

const orphans = [];

// Only subscriptions that could still charge someone are worth acting on.
for (const status of ["active", "trialing", "past_due", "unpaid"]) {
  let startingAfter;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const sub of page.data) {
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

      if (knownSubscriptions.has(sub.id)) continue;
      if (customerId && knownCustomers.has(customerId)) continue;

      let email = null;
      try {
        if (customerId) {
          const c = await stripe.customers.retrieve(customerId);
          email = c && !c.deleted ? (c.email ?? null) : null;
        }
      } catch {
        // A missing customer does not change the verdict.
      }

      orphans.push({ id: sub.id, status: sub.status, customerId, email });
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
  }
}

if (orphans.length === 0) {
  console.log("\nNo orphaned subscriptions. Nothing to do.\n");
  process.exit(0);
}

for (const o of orphans) {
  console.log(
    `\n  ${o.id}  ${o.status.padEnd(10)} ${o.email ?? "(no email)"}\n` +
      `    customer ${o.customerId ?? "(none)"} — not referenced by any local row`
  );
}

console.log("\n" + "=".repeat(66));
console.log(`Orphaned subscriptions still billable: ${orphans.length}`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to cancel these.\n");
  process.exit(0);
}

console.log("\nCancelling...\n");

let cancelled = 0;
const failures = [];

for (const o of orphans) {
  try {
    await stripe.subscriptions.cancel(o.id);
    cancelled += 1;
    console.log(`  cancelled ${o.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Already gone is the outcome we wanted anyway.
    if (/No such subscription|already canceled/i.test(message)) {
      cancelled += 1;
      console.log(`  already cancelled ${o.id}`);
      continue;
    }
    failures.push({ id: o.id, message });
    console.error(`  FAILED ${o.id} — ${message}`);
  }
}

console.log(`\nCancelled: ${cancelled} | Failed: ${failures.length}\n`);
process.exit(failures.length > 0 ? 1 : 0);
