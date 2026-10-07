/**
 * Pre-flight for the wipe: what user data exists right now.
 *
 * Run BEFORE `supabase/scripts/wipe-user-data.sql` so the deletion is an
 * informed decision rather than a hopeful one, and AFTER to confirm the wipe
 * actually reached every table — a wipe that silently misses one leaves the
 * next test run resuming into old answers, which looks like a bug in the code.
 *
 * Read-only.
 *
 *   node scripts/count-user-data.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

/** Tables the wipe is expected to empty. */
const USER_DATA = [
  "companies",
  "profiles",
  "planning_inputs",
  "intake_products",
  "intake_initiatives",
  "intake_events",
  "products",
  "annual_plans",
  "initiatives",
  "tasks",
  "results",
  "expenses",
  "projections",
  "monthly_plans",
  "quarterly_plans",
  "weekly_plans",
  "plan_snapshots",
  "plan_suggestions",
  "subscriptions",
  "billing_invoices",
  "usage_counters",
  "generation_events",
  "chat_conversations",
  "chat_messages",
  "chat_budgets",
  "activity_log",
  "app_notifications",
  "internal_team",
];

/** Config the wipe must PRESERVE. A zero here means something went wrong. */
const CONFIG = [
  "initiative_types",
  "wb_initiative_library",
  "wb_task_templates",
  "wb_benchmarks",
  "wb_ai_context",
  "subscription_plans",
  "plan_limits",
  "plan_features",
  "app_settings",
  "email_templates",
  "notification_rules",
];

async function count(table) {
  const { count: n, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) return null;
  return n ?? 0;
}

console.log("\n=== USER DATA (the wipe should empty these) ===\n");

let userRows = 0;
for (const table of USER_DATA) {
  const n = await count(table);
  if (n === null) {
    console.log(`  ${table.padEnd(26)} (no such table)`);
    continue;
  }
  userRows += n;
  console.log(`  ${table.padEnd(26)} ${n}`);
}

const { data: users } = await db.auth.admin.listUsers();
const authCount = users?.users?.length ?? 0;
console.log(`  ${"auth.users".padEnd(26)} ${authCount}`);
if (authCount > 0) {
  for (const user of users.users) {
    console.log(`      ${user.email ?? "(no email)"}  created ${user.created_at.slice(0, 10)}`);
  }
}

console.log("\n=== CONFIG (the wipe must KEEP these) ===\n");

const emptyConfig = [];
for (const table of CONFIG) {
  const n = await count(table);
  if (n === null) {
    console.log(`  ${table.padEnd(26)} (no such table)`);
    continue;
  }
  if (n === 0) emptyConfig.push(table);
  console.log(`  ${table.padEnd(26)} ${n}`);
}

console.log("\n" + "=".repeat(58));
console.log(`\n${userRows} user rows + ${authCount} auth users.\n`);

if (emptyConfig.length > 0) {
  /**
   * Called out because an empty library is not obvious in the UI — the
   * initiative picker simply shows nothing, which reads as a broken screen
   * rather than as missing data.
   */
  console.log("Config tables that are EMPTY and probably should not be:\n");
  for (const table of emptyConfig) console.log(`  - ${table}`);
  console.log(
    "\nIf wb_initiative_library is empty, the intake picker will have no\n" +
      "options. Re-upload the workbook from Admin -> AI Workbook.\n"
  );
}

process.exit(0);
