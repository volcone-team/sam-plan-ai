/**
 * What would deleting a subscription plan do to existing subscribers?
 *
 * Read-only. Reports who is on each plan, what the foreign keys would do, and
 * what the app would do about it.
 *
 * Usage: node scripts/inspect-plan-deletion.mjs
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

const [{ data: plans }, { data: subs }, { data: settings }] = await Promise.all([
  db
    .from("subscription_plans")
    .select("id, name, monthly_price, annual_price, is_default, is_active, display_order")
    .order("display_order"),
  db
    .from("subscriptions")
    .select(
      "company_id, plan_id, pending_plan_id, tier, status, stripe_status, " +
      "stripe_subscription_id, is_comped, is_paused"
    ),
  db.from("app_settings").select("trial_plan_id").eq("id", "global").maybeSingle(),
]);

const { data: companies } = await db.from("companies").select("id, name");
const nameOf = new Map((companies ?? []).map((c) => [c.id, c.name]));

const [{ data: limits }, { data: features }, { data: prices }] = await Promise.all([
  db.from("plan_limits").select("plan_id, limit_key"),
  db.from("plan_features").select("plan_id, feature_key"),
  db.from("stripe_prices").select("plan_id, billing_cycle, is_current"),
]);

console.log("\n" + "=".repeat(64));
console.log("PLANS, AND WHO IS ON THEM");
console.log("=".repeat(64));

for (const plan of plans ?? []) {
  const onPlan = (subs ?? []).filter((s) => s.plan_id === plan.id);
  const pendingTo = (subs ?? []).filter((s) => s.pending_plan_id === plan.id);
  const paying = onPlan.filter(
    (s) =>
      s.stripe_subscription_id &&
      ["active", "trialing", "past_due"].includes(s.stripe_status ?? "")
  );
  const comped = onPlan.filter((s) => s.is_comped);
  const isTrialPlan = settings?.trial_plan_id === plan.id || (!settings?.trial_plan_id && plan.is_default);

  console.log(`\n${plan.name}  ($${plan.monthly_price}/mo, $${plan.annual_price}/yr)`);
  console.log(`  ${plan.is_active ? "active" : "INACTIVE"}${plan.is_default ? " · default" : ""}${isTrialPlan ? " · trials land here" : ""}`);
  console.log(`  subscriptions on it : ${onPlan.length}`);
  console.log(`    of which PAYING   : ${paying.length}`);
  console.log(`    of which comped   : ${comped.length}`);
  console.log(`  scheduled to switch TO it: ${pendingTo.length}`);
  console.log(`  plan_limits rows    : ${(limits ?? []).filter((l) => l.plan_id === plan.id).length}`);
  console.log(`  plan_features rows  : ${(features ?? []).filter((f) => f.plan_id === plan.id).length}`);
  console.log(`  stripe_prices rows  : ${(prices ?? []).filter((p) => p.plan_id === plan.id).length}`);

  for (const s of onPlan) {
    const tags = [
      s.stripe_subscription_id ? `stripe:${s.stripe_status}` : "no stripe sub",
      s.is_comped ? "comped" : null,
      s.is_paused ? "paused" : null,
    ].filter(Boolean);
    console.log(`    - ${nameOf.get(s.company_id) ?? s.company_id}  [${tags.join(", ")}]`);
  }
}

console.log("\n" + "=".repeat(64));
console.log("WHAT A DELETE WOULD DO");
console.log("=".repeat(64));

const inUse = (plans ?? []).filter((p) =>
  (subs ?? []).some((s) => s.plan_id === p.id)
);

console.log(`
APP GUARD: /api/admin/plans DELETE refuses with 400 "plan_in_use" when any
subscription references the plan. So through the admin UI you CANNOT delete
these:
`);
for (const p of inUse) {
  const n = (subs ?? []).filter((s) => s.plan_id === p.id).length;
  console.log(`  - ${p.name}  (${n} subscription${n === 1 ? "" : "s"})`);
}
if (inUse.length === 0) console.log("  (none — every plan is unreferenced)");

const deletable = (plans ?? []).filter(
  (p) => !(subs ?? []).some((s) => s.plan_id === p.id)
);
console.log(`
Deletable through the UI right now:`);
for (const p of deletable) console.log(`  - ${p.name}`);
if (deletable.length === 0) console.log("  (none)");

console.log(`
IF DELETED DIRECTLY IN SQL (bypassing the guard), the foreign keys decide:

  subscriptions.plan_id          ON DELETE SET NULL  -> becomes NULL
  subscriptions.pending_plan_id  ON DELETE SET NULL  -> becomes NULL
  app_settings.trial_plan_id     ON DELETE SET NULL  -> becomes NULL
  plan_limits                    ON DELETE CASCADE   -> rows deleted
  plan_features                  ON DELETE CASCADE   -> rows deleted
  stripe_prices                  ON DELETE CASCADE   -> rows deleted

Consequence for a paying customer: Stripe keeps charging them (the Stripe
subscription is untouched), but plan_id is NULL so no plan_limits rows can be
found. Every limited feature then reads as "not included", so they pay and
cannot use what they paid for.
`);

console.log("");
