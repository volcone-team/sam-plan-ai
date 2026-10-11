/**
 * Stripe customers that no longer match any account in this database.
 *
 * Deleting a user or company removes the local rows but does NOT touch Stripe:
 * the customer and their subscription live on. Re-registering the same email
 * then lets `/api/billing/reconcile` find that old customer BY EMAIL and adopt
 * its subscription — so a brand-new account inherits a plan it never bought.
 *
 * Read-only. Usage: node scripts/inspect-stripe-orphans.mjs
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const key =
  process.env.STRIPE_SECRET_KEY_TEST ||
  process.env.STRIPE_SECRET_KEY ||
  null;

if (!key) {
  console.error("No Stripe secret key in .env.local");
  process.exit(1);
}

const stripe = new Stripe(key);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: profiles } = await db.from("profiles").select("email");
const liveEmails = new Set(
  (profiles ?? []).map((p) => String(p.email ?? "").toLowerCase()).filter(Boolean)
);

const { data: subs } = await db
  .from("subscriptions")
  .select("company_id, stripe_customer_id, stripe_subscription_id");
const knownCustomers = new Set(
  (subs ?? []).map((s) => s.stripe_customer_id).filter(Boolean)
);

console.log(`\nAccounts in database: ${liveEmails.size}`);
console.log(`Stripe customer ids referenced locally: ${knownCustomers.size}\n`);
console.log("=".repeat(66));
console.log("STRIPE CUSTOMERS");
console.log("=".repeat(66));

const customers = await stripe.customers.list({ limit: 100 });
let orphanCount = 0;
let orphanWithLiveSub = 0;

for (const c of customers.data) {
  const email = String(c.email ?? "").toLowerCase();
  const subsFor = await stripe.subscriptions.list({
    customer: c.id,
    status: "all",
    limit: 10,
  });

  const live = subsFor.data.filter((s) =>
    ["active", "trialing", "past_due"].includes(s.status)
  );

  const emailMatches = email && liveEmails.has(email);
  const idKnown = knownCustomers.has(c.id);
  const orphan = !idKnown;

  if (orphan) orphanCount += 1;
  if (orphan && live.length > 0) orphanWithLiveSub += 1;

  const flags = [
    idKnown ? "linked locally" : "NOT linked locally",
    emailMatches ? "email matches a live account" : "email has no account",
    live.length > 0 ? `${live.length} LIVE sub` : "no live sub",
  ];

  console.log(
    `\n  ${c.id}  ${(c.email ?? "(no email)").padEnd(34)}` +
      `\n    created ${new Date(c.created * 1000).toISOString().slice(0, 10)} | ${flags.join(" | ")}`
  );

  for (const s of subsFor.data) {
    console.log(
      `      sub ${s.id}  ${s.status.padEnd(10)} ` +
        `plan_id=${s.metadata?.plan_id ?? "-"}`
    );
  }

  // The dangerous combination: an orphan whose email belongs to a NEW account.
  if (orphan && emailMatches && live.length > 0) {
    console.log(
      "      ^^ ADOPTABLE: reconcile would find this by email and attach its\n" +
        "         live subscription to the new account of the same address."
    );
  }
}

console.log("\n" + "=".repeat(66));
console.log(`Stripe customers not linked to any local row : ${orphanCount}`);
console.log(`...of those, carrying a LIVE subscription     : ${orphanWithLiveSub}`);
console.log("=".repeat(66) + "\n");
