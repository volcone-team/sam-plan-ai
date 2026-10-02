/**
 * Cancel and delete ALL Stripe TEST-mode customers and subscriptions.
 *
 * The database wipe does nothing to Stripe — the two are separate systems. After
 * clearing user data in Supabase you also want the matching Stripe customers
 * gone, or a future signup reusing an email could reconnect to a ghost customer
 * with a stale subscription.
 *
 * Run:  node scripts/stripe-wipe-test.mjs            (dry run — lists only)
 *       node scripts/stripe-wipe-test.mjs --confirm  (actually deletes)
 *
 * SAFETY:
 *   - Refuses to run against a live key. Test mode only, always.
 *   - Dry run by default: shows what WOULD be deleted and stops.
 *   - Does NOT touch products or prices — those are your plan config, kept.
 */

import { readFileSync } from "node:fs";
import Stripe from "stripe";

function env(key) {
  const file = readFileSync(".env.local", "utf8");
  const m = file.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

const key = env("STRIPE_SECRET_KEY");
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local");
  process.exit(1);
}
if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
  console.error("REFUSING: that is a LIVE key. This script only clears TEST data.");
  process.exit(1);
}

const confirm = process.argv.includes("--confirm");
const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });

async function main() {
  console.log(confirm ? "DELETING test customers...\n" : "DRY RUN — nothing will be deleted. Pass --confirm to delete.\n");

  let customers = 0;
  let subs = 0;
  let starting_after;

  // Deleting a customer cancels its subscriptions automatically, so iterating
  // customers is enough — but subscriptions are counted first for visibility.
  for (;;) {
    const page = await stripe.customers.list({ limit: 100, ...(starting_after ? { starting_after } : {}) });
    if (page.data.length === 0) break;

    for (const customer of page.data) {
      const subList = await stripe.subscriptions.list({
        customer: customer.id, status: "all", limit: 100,
      });
      subs += subList.data.length;

      console.log(
        `${confirm ? "delete" : "would delete"}  ${customer.id}  ${customer.email ?? "(no email)"}  ` +
        `(${subList.data.length} subscription${subList.data.length === 1 ? "" : "s"})`
      );

      if (confirm) {
        // Deleting the customer cancels and detaches everything under it.
        await stripe.customers.del(customer.id);
      }
      customers += 1;
    }

    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }

  console.log(
    `\n${confirm ? "Deleted" : "Would delete"} ${customers} customer(s) and ${subs} subscription(s).`
  );
  if (!confirm) console.log("Re-run with --confirm to apply.");
  console.log("Products and prices were left untouched.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
