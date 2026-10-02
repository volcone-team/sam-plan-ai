/**
 * Read-only diagnosis of WHY an invoice is unattributed.
 *
 * Deleting an orphan is easy; knowing whether a new one means the fix leaked or
 * simply that an old Stripe customer paid is the part that matters. This prints
 * each orphan with its Stripe customer, and whether that customer maps to any
 * subscription row in this database.
 *
 * READS ONLY — Supabase and Stripe both read-only. Prints no secrets.
 *
 *   node scripts/inspect-orphan-invoices.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const usd = (minor) => `$${((minor ?? 0) / 100).toFixed(2)}`;

const { data: orphans } = await db
  .from("billing_invoices")
  .select("stripe_invoice_id, stripe_customer_id, amount_paid, status, created_at, updated_at")
  .is("company_id", null)
  .order("created_at", { ascending: false });

if (!orphans?.length) {
  console.log("\nNo unattributed invoices.\n");
  process.exit(0);
}

console.log(`\n${orphans.length} unattributed invoice(s)\n`);

for (const inv of orphans) {
  console.log(`  ${inv.stripe_invoice_id}  ${usd(inv.amount_paid)}  ${inv.status}`);
  console.log(`    stored            ${inv.created_at}`);
  console.log(`    customer          ${inv.stripe_customer_id ?? "(none)"}`);

  if (!inv.stripe_customer_id) {
    console.log("    cause             no customer id — cannot ever be attributed\n");
    continue;
  }

  // Does this customer still exist in Stripe, and whose is it?
  try {
    const cust = await stripe.customers.retrieve(inv.stripe_customer_id);
    if (cust.deleted) {
      console.log("    stripe customer   DELETED in Stripe");
    } else {
      console.log(`    stripe customer   ${cust.email ?? "(no email)"}`);
      const metaCompany = cust.metadata?.company_id;
      if (metaCompany) {
        const { data: co } = await db
          .from("companies").select("id, name").eq("id", metaCompany).maybeSingle();
        console.log(
          `    metadata company  ${metaCompany} ${co ? `→ "${co.name}" (EXISTS)` : "→ not in this database"}`
        );
      }
    }
  } catch (err) {
    console.log(`    stripe customer   unreadable: ${err.message}`);
  }

  // The attribution path the webhook uses: customer id → subscriptions row.
  const { data: sub } = await db
    .from("subscriptions")
    .select("company_id, stripe_mode")
    .eq("stripe_customer_id", inv.stripe_customer_id)
    .maybeSingle();

  if (sub?.company_id) {
    console.log(`    local lookup      maps to company ${sub.company_id} — SHOULD have attributed`);
  } else {
    console.log("    local lookup      no subscriptions row for this customer");
    console.log("    cause             customer belongs to no account here (old test data)");
  }
  console.log("");
}

console.log(
  "Invoices whose customer maps to no account here are not this app's revenue.\n" +
  "Clear them with supabase/scripts/purge-orphan-invoices.sql.\n"
);
