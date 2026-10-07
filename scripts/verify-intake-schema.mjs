/**
 * Verify migration 025 (intake v2) actually applied.
 *
 * Checks the new tables exist, are readable, and that every column the intake
 * form writes is present. Run AFTER applying the migration in the Supabase SQL
 * editor — a missing column surfaces here as one clear line rather than as a
 * silent save failure halfway through a customer's questionnaire.
 *
 * READS ONLY. It selects zero rows (limit 0) purely to confirm each column
 * resolves.
 *
 *   node scripts/verify-intake-schema.mjs
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

let failures = 0;
const fail = (m) => { failures += 1; console.log("  FAIL  " + m); };
const pass = (m) => console.log("  ok    " + m);

/** New scalar columns on planning_inputs, by screen. */
const PLANNING_INPUT_COLUMNS = [
  // --- migration 025 ---
  "intake_path", "intake_version",
  "industry", "business_description", "prior_period_revenue",
  "purchase_mode", "growth_stage",
  "sales_owner", "plan_owner", "weekly_hours",
  "horizon_months", "plan_start_month",
  "what_worked_notes", "what_failed_notes",
  "sells_to", "customer_industries", "problem_solved",
  "email_list_size", "email_list_unknown",
  "social_following", "social_following_unknown",
  "monthly_visitors", "monthly_visitors_unknown",
  "past_customers", "past_customers_unknown",
  "monthly_leads", "monthly_leads_unknown",
  "borrowed_audiences",
  "challenges", "challenge_notes",
  // --- migration 026 ---
  "industry_other", "resume_screen", "onboarding_status",
  "signed_up_at", "intake_started_at", "intake_complete_at",
  "plan_viewed_at", "first_actuals_at",
];

const INTAKE_PRODUCT_COLUMNS = [
  "id", "company_id", "planning_input_id", "name", "product_type",
  "price_level", "payment_type", "delivery_mode",
  "average_price", "units_in_period", "display_order",
  // --- migration 026 ---
  "recurring_interval",
];

const INTAKE_INITIATIVE_COLUMNS = [
  "id", "company_id", "planning_input_id", "source",
  "initiative_key", "initiative_label", "product_ids",
  "cadence", "repeat_frequency", "start_month", "exact_date",
  "has_run_before", "audience_reached", "funnel_stages", "average_price",
  "failure_reason", "display_order",
  // --- migration 026 ---
  "custom_label", "needs_review",
];

/** The analytics sink (migration 026). */
const INTAKE_EVENT_COLUMNS = [
  "id", "company_id", "user_id", "event", "screen", "plan_path",
  "properties", "created_at",
];

/**
 * Select the columns together first (one round trip). Only on failure fall back
 * to checking one at a time, so a healthy schema stays fast but a broken one
 * still names the exact missing column.
 */
async function checkColumns(table, columns) {
  const { error } = await db.from(table).select(columns.join(", ")).limit(0);
  if (!error) {
    pass(`${table}: all ${columns.length} columns present`);
    return;
  }

  console.log(`  ....  ${table}: ${error.message}`);
  for (const col of columns) {
    const { error: colErr } = await db.from(table).select(col).limit(0);
    if (colErr) fail(`${table}.${col} — ${colErr.message}`);
  }
}

console.log("\nIntake v2 schema (migration 025)\n");

// Table existence first: every column check below would otherwise fail
// identically and bury the real cause.
for (const table of ["intake_products", "intake_initiatives", "intake_events"]) {
  const { error } = await db.from(table).select("id").limit(0);
  if (error) {
    fail(`table ${table} is missing or unreadable — ${error.message}`);
  } else {
    pass(`table ${table} exists`);
  }
}

console.log("");
await checkColumns("planning_inputs", PLANNING_INPUT_COLUMNS);
await checkColumns("intake_products", INTAKE_PRODUCT_COLUMNS);
await checkColumns("intake_initiatives", INTAKE_INITIATIVE_COLUMNS);
await checkColumns("intake_events", INTAKE_EVENT_COLUMNS);

// The intake's initiative picker is populated from the workbook library, so an
// empty library means screens 5 and 6 have nothing to offer.
console.log("");
const { count: libraryCount } = await db
  .from("wb_initiative_library")
  .select("initiative_key", { count: "exact", head: true });

if (!libraryCount) {
  fail("wb_initiative_library is empty — the initiative picker will have no options");
} else {
  pass(`wb_initiative_library: ${libraryCount} initiatives available to pick from`);
}

console.log(
  failures === 0
    ? "\nSchema ready for intake v2.\n"
    : `\n${failures} problem(s). Apply these in the Supabase SQL editor, in order:\n` +
      "  supabase/migrations/025_intake_v2.sql\n" +
      "  supabase/migrations/026_intake_v2_remaining.sql\n"
);
process.exit(failures === 0 ? 0 : 1);
