/**
 * Stripe test-mode smoke test.
 *
 * Exercises the subscription lifecycle against REAL Stripe test mode, which is
 * the only way to catch the class of bug that unit tests cannot: Stripe refusing
 * an operation, proration behaving unexpectedly, or a field moving between API
 * versions.
 *
 * Run:  node scripts/stripe-smoke.mjs
 *
 * SAFE BY CONSTRUCTION:
 *   - Refuses to run against a live key. Every object it creates is test-mode.
 *   - Everything it creates is tagged { smoke: "1" } and deleted at the end,
 *     including on failure, so it cannot leave clutter or a billing customer
 *     behind in your account.
 *   - It never touches existing customers, subscriptions or prices.
 *
 * This does NOT test the app's routes — it verifies the Stripe operations those
 * routes depend on. Run it after any change to checkout, change-plan or the
 * webhook handler.
 */

import { readFileSync } from "node:fs";
import Stripe from "stripe";

function env(key) {
  const file = readFileSync(".env.local", "utf8");
  const match = file.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

const key = env("STRIPE_SECRET_KEY");
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local");
  process.exit(1);
}
// Hard stop: this script creates and cancels subscriptions. Against a live key it
// would touch real money.
if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
  console.error("REFUSING TO RUN: that is a LIVE key. This script only runs in test mode.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-08-26.dahlia" });

const created = { customers: [], products: [], schedules: [] };
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function cleanup() {
  console.log("\nCleaning up...");
  for (const id of created.schedules) {
    try { await stripe.subscriptionSchedules.release(id); } catch {}
  }
  for (const id of created.customers) {
    // Deleting a customer cancels its subscriptions, so this is sufficient.
    try { await stripe.customers.del(id); } catch (e) { console.log("  customer", id, e.message.slice(0, 60)); }
  }
  for (const id of created.products) {
    try { await stripe.products.update(id, { active: false }); } catch {}
  }
  console.log("  done");
}

async function main() {
  console.log("Stripe smoke test (test mode only)\n");

  // ---- Fixtures: a throwaway product with two prices -----------------------
  const product = await stripe.products.create({
    name: "SMOKE TEST — delete me",
    metadata: { smoke: "1" },
  });
  created.products.push(product.id);

  const cheap = await stripe.prices.create({
    product: product.id, unit_amount: 1000, currency: "usd",
    recurring: { interval: "month" }, metadata: { smoke: "1" },
  });
  const dear = await stripe.prices.create({
    product: product.id, unit_amount: 5000, currency: "usd",
    recurring: { interval: "month" }, metadata: { smoke: "1" },
  });

  // A customer with a working test card attached.
  const customer = await stripe.customers.create({
    email: `smoke-${Date.now()}@example.com`,
    name: "Smoke Test",
    address: { line1: "1 Test St", city: "Testville", country: "US", postal_code: "10001", state: "NY" },
    metadata: { smoke: "1" },
  });
  created.customers.push(customer.id);

  const pm = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  // ---- 1. Checkout session with automatic tax -----------------------------
  console.log("1. Checkout session (automatic tax + address saving)");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price: cheap.id, quantity: 1 }],
    success_url: "https://example.com/ok",
    cancel_url: "https://example.com/no",
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    metadata: { company_id: "smoke-company", plan_id: "smoke-plan" },
  });
  check("session created", !!session.url);
  check("metadata carried", session.metadata?.company_id === "smoke-company");

  // ---- 2. Subscription, then an immediate upgrade -------------------------
  console.log("\n2. Upgrade applies immediately and prorates");
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: cheap.id }],
    metadata: { company_id: "smoke-company" },
  });
  check("subscription active", sub.status === "active", `status=${sub.status}`);

  const upgraded = await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0].id, price: dear.id }],
    proration_behavior: "always_invoice",
  });
  check("price switched immediately", upgraded.items.data[0].price.id === dear.id);

  // ---- 3. Downgrade schedules at period end ------------------------------
  console.log("\n3. Downgrade schedules at period end");
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  created.schedules.push(schedule.id);

  const nowSec = Math.floor(Date.now() / 1000);
  const phase = schedule.phases.find(
    (p) => p.start_date <= nowSec && (!p.end_date || p.end_date > nowSec)
  ) ?? schedule.phases[schedule.phases.length - 1];
  check("current phase found", !!phase);

  const scheduled = await stripe.subscriptionSchedules.update(schedule.id, {
    phases: [
      { items: [{ price: dear.id, quantity: 1 }], start_date: phase.start_date, end_date: phase.end_date },
      { items: [{ price: cheap.id, quantity: 1 }] },
    ],
  });
  check("two phases scheduled", scheduled.phases.length === 2);
  check(
    "second phase is the cheaper plan",
    scheduled.phases[1].items[0].price === cheap.id ||
      scheduled.phases[1].items[0].price?.id === cheap.id
  );

  // ---- 4. THE BUG: a second create() on a scheduled subscription fails ----
  console.log("\n4. A scheduled subscription rejects a second schedule (must reuse)");
  let secondCreateFailed = false;
  try {
    await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  } catch (err) {
    secondCreateFailed = /already attached to a schedule/i.test(err.message);
  }
  check("creating a second schedule is rejected by Stripe", secondCreateFailed);

  // Reuse instead — this is the fix, and it must work.
  const revised = await stripe.subscriptionSchedules.update(schedule.id, {
    phases: [
      { items: [{ price: dear.id, quantity: 1 }], start_date: phase.start_date, end_date: phase.end_date },
      { items: [{ price: dear.id, quantity: 1 }] },
    ],
  });
  check("reusing the schedule succeeds", revised.phases.length === 2);

  // ---- 5. Release, so an upgrade is not reverted later -------------------
  console.log("\n5. Releasing a schedule keeps the subscription alive");
  const released = await stripe.subscriptionSchedules.release(schedule.id);
  check("schedule released", released.status === "released");
  const afterRelease = await stripe.subscriptions.retrieve(sub.id);
  check("subscription still active", afterRelease.status === "active", `status=${afterRelease.status}`);
  check("schedule detached", !afterRelease.schedule);

  // ---- 6. Duplicate-purchase guard ---------------------------------------
  console.log("\n6. A live subscription is discoverable before selling again");
  const live = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10 });
  const anyLive = live.data.some((s) =>
    ["active", "trialing", "past_due", "unpaid"].includes(s.status)
  );
  check("Stripe reports an existing live subscription", anyLive);

  // ---- 7. Invoice shape the webhook depends on --------------------------
  console.log("\n7. Invoice exposes its subscription id where the handler looks");
  const invoices = await stripe.invoices.list({ customer: customer.id, limit: 5 });
  const withSub = invoices.data.find(
    (i) => i.parent?.subscription_details?.subscription || i.subscription
  );
  check("invoice links back to a subscription", !!withSub,
    "if this fails, the webhook cannot resync after a payment");
}

try {
  await main();
} catch (err) {
  failed += 1;
  console.error("\nUNCAUGHT:", err.message);
} finally {
  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
