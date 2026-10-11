/**
 * WHO WOULD BE LOCKED OUT if the entitlement gate deployed right now?
 *
 * The middleware gate blocks every app page when `evaluateAccess` denies and
 * the reason is pay-to-continue. That is a behaviour change for accounts that
 * ALREADY EXIST, and it is silent: nothing crashes, customers simply find
 * themselves on a purchase screen. This answers the question before the deploy
 * rather than after.
 *
 * Read-only. Usage: node scripts/preflight-lockout.mjs
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

const { data: settings } = await db
  .from("app_settings")
  .select("stripe_enabled, trial_enabled, trial_days, dunning_grace_days, trial_plan_id")
  .eq("id", "global")
  .maybeSingle();

const stripeEnabled = settings?.stripe_enabled === true;

console.log("\n" + "=".repeat(68));
console.log("PRE-FLIGHT: who does the entitlement gate lock out?");
console.log("=".repeat(68));
console.log(`\n  stripe_enabled = ${stripeEnabled}`);

if (!stripeEnabled) {
  console.log(
    "\n  Billing is OFF, so evaluateAccess returns billing_disabled for\n" +
    "  everyone and the gate never fires. Deploying is a no-op for access.\n"
  );
}

const { data: companies } = await db.from("companies").select("id, name");
const { data: profiles } = await db
  .from("profiles")
  .select("id, email, company_id, is_admin, role");
const { data: subs } = await db
  .from("subscriptions")
  .select(
    "company_id, plan_id, status, stripe_status, stripe_subscription_id, " +
    "is_comped, comped_until, trial_ends_at, current_period_end, " +
    "past_due_since, cancel_at_period_end, is_paused"
  );

const subByCompany = new Map((subs ?? []).map((s) => [s.company_id, s]));
const now = Date.now();

/** Mirrors evaluateAccess precedence. Kept deliberately simple and explicit. */
function verdict(sub) {
  if (!stripeEnabled) return { allowed: true, reason: "billing_disabled" };
  if (!sub) return { allowed: false, reason: "no_subscription" };
  if (sub.is_paused) return { allowed: false, reason: "paused" };

  if (sub.is_comped) {
    const until = sub.comped_until ? new Date(sub.comped_until).getTime() : null;
    if (until === null || until > now) return { allowed: true, reason: "comped" };
    if (!["active", "trialing"].includes(sub.stripe_status ?? sub.status)) {
      return { allowed: false, reason: "comp_expired" };
    }
  }

  const status = sub.stripe_status ?? sub.status;

  if (status === "trialing" || status === "trial") {
    const ends = sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : null;
    if (ends === null) return { allowed: true, reason: "trialing" };
    if (ends > now) {
      const days = Math.ceil((ends - now) / 86400000);
      return { allowed: true, reason: `trialing (${days}d left)` };
    }
    return { allowed: false, reason: "trial_expired" };
  }

  if (status === "active") return { allowed: true, reason: "active" };

  if (status === "past_due" || status === "unpaid") {
    const since = sub.past_due_since ? new Date(sub.past_due_since).getTime() : null;
    const grace = (settings?.dunning_grace_days ?? 7) * 86400000;
    if (since === null || since + grace > now) {
      return { allowed: true, reason: "grace_period" };
    }
    return { allowed: false, reason: "past_due_expired" };
  }

  if (status === "canceled" || status === "cancelled" || status === "paused") {
    return { allowed: false, reason: "canceled" };
  }

  return { allowed: false, reason: "incomplete" };
}

const PURCHASE_REASONS = [
  "trial_expired", "no_subscription", "canceled",
  "comp_expired", "past_due_expired", "incomplete",
];

let lockedOut = 0;
let fine = 0;
let adminExempt = 0;

console.log("\n" + "-".repeat(68));

for (const c of companies ?? []) {
  const sub = subByCompany.get(c.id) ?? null;
  const v = verdict(sub);
  const members = (profiles ?? []).filter((p) => p.company_id === c.id);
  const admins = members.filter((p) => p.is_admin);
  const customers = members.filter((p) => !p.is_admin);

  const wouldBlock =
    !v.allowed && PURCHASE_REASONS.includes(v.reason.split(" ")[0]);

  // Super admins bypass the gate entirely — they are who fixes it.
  const blockedPeople = wouldBlock ? customers.length : 0;
  if (blockedPeople > 0) lockedOut += blockedPeople;
  else fine += customers.length;
  adminExempt += admins.length;

  const mark = wouldBlock
    ? (blockedPeople > 0 ? "LOCKED OUT" : "blocked, but only admins")
    : v.reason === "paused"
      ? "-> /account-paused"
      : "ok";

  console.log(
    `\n  ${(c.name ?? c.id).padEnd(16)} ${v.reason.padEnd(22)} ${mark}` +
      `\n    subscription: ${sub ? `status=${sub.stripe_status ?? sub.status} stripe_sub=${sub.stripe_subscription_id ? "yes" : "no"} comped=${sub.is_comped}` : "NONE"}` +
      `\n    members: ${customers.length} customer(s), ${admins.length} admin(s)`
  );
  for (const p of members) {
    console.log(`      - ${p.email}${p.is_admin ? "  [admin, exempt]" : ""}`);
  }
}

console.log("\n" + "=".repeat(68));
console.log(`  customers who would be LOCKED OUT : ${lockedOut}`);
console.log(`  customers unaffected              : ${fine}`);
console.log(`  admins (always exempt)            : ${adminExempt}`);
console.log("=".repeat(68));

if (lockedOut > 0) {
  console.log(
    "\n  These accounts can still sign in, but every page redirects to\n" +
    "  /choose-plan until they buy a plan. Nothing is deleted and an admin\n" +
    "  can restore access instantly with Grant access.\n"
  );
} else {
  console.log("\n  No existing customer loses access on deploy.\n");
}
