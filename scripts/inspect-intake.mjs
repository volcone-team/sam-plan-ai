/**
 * Show what the intake actually saved, for manual testing.
 *
 * The screens can look right while storing something wrong — a null that
 * became a 0, a "Not sure" that lost its flag, a funnel stage that dropped out
 * of the array. None of that is visible in the browser, so this prints the
 * stored rows and FLAGS the specific mistakes worth looking for.
 *
 * Read-only. Safe to run against any database.
 *
 *   node scripts/inspect-intake.mjs                 # most recent intake
 *   node scripts/inspect-intake.mjs you@example.com # a specific user
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

const email = process.argv[2] ?? null;

/** Resolve which company to inspect. */
let companyId = null;
if (email) {
  const { data: users } = await db.auth.admin.listUsers();
  const user = (users?.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    console.log(`No user with email ${email}`);
    process.exit(1);
  }
  const { data: profile } = await db
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  companyId = profile?.company_id ?? null;
  if (!companyId) {
    console.log(`${email} has no company_id on their profile.`);
    process.exit(1);
  }
}

const { data: input } = await (companyId
  ? db
      .from("planning_inputs")
      .select("*")
      .eq("company_id", companyId)
      .eq("intake_version", 2)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  : db
      .from("planning_inputs")
      .select("*")
      .eq("intake_version", 2)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle());

if (!input) {
  console.log(
    "\nNo v2 intake found.\n" +
      "Either nobody has reached screen 1 yet, or the draft save is failing —\n" +
      "check the terminal running `npm run dev` for [intake/draft] errors.\n"
  );
  process.exit(0);
}

console.log(`\nIntake ${input.id}`);
console.log(`Company ${input.company_id}`);
console.log(`Created ${input.created_at}`);

const problems = [];
const show = (label, value) =>
  console.log(`  ${label.padEnd(30)} ${format(value)}`);

function format(value) {
  if (value === null) return "null";
  if (value === undefined) return "(column absent)";
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "[]";
  return String(value);
}

console.log("\n=== PROGRESS ===\n");
show("resume_screen", input.resume_screen);
show("onboarding_status", input.onboarding_status);
show("intake_started_at", input.intake_started_at);
show("intake_complete_at", input.intake_complete_at);
show("completed_at", input.completed_at);

console.log("\n=== SCREEN 0-2 ===\n");
show("intake_path", input.intake_path);
show("industry", input.industry);
show("industry_other", input.industry_other);
show("business_description", input.business_description);
show("purchase_mode", input.purchase_mode);
show("prior_period_revenue", input.prior_period_revenue);
show("growth_stage", input.growth_stage);
show("team_size", input.team_size);
show("sales_owner", input.sales_owner);
show("plan_owner", input.plan_owner);
show("weekly_hours", input.weekly_hours);
show("monthly_marketing_budget", input.monthly_marketing_budget);

// "Other" with no text leaves the generator nothing to filter the library on.
if (input.industry === "Other" && !input.industry_other) {
  problems.push('industry is "Other" but industry_other is empty');
}
// Switching away from Other should clear the free text.
if (input.industry && input.industry !== "Other" && input.industry_other) {
  problems.push(
    `industry is "${input.industry}" but stale industry_other "${input.industry_other}" survived`
  );
}

console.log("\n=== SCREEN 3-4 ===\n");
show("horizon_months", input.horizon_months);
show("plan_start_month", input.plan_start_month);
show("revenue_goal", input.revenue_goal);

if (input.horizon_months && ![3, 6, 12, 18].includes(Number(input.horizon_months))) {
  problems.push(`horizon_months is ${input.horizon_months}, expected 3/6/12/18`);
}

console.log("\n=== SCREEN 6-7 ===\n");
show("what_worked_notes", truncate(input.what_worked_notes));
show("sells_to", input.sells_to);
show("customer_industries", input.customer_industries);
show("ideal_customer_description", truncate(input.ideal_customer_description));
show("problem_solved", truncate(input.problem_solved));

console.log("\n=== SCREEN 8: audience (null vs 0 matters) ===\n");

const AUDIENCE = [
  ["email_list_size", "email_list_unknown"],
  ["social_following", "social_following_unknown"],
  ["monthly_visitors", "monthly_visitors_unknown"],
  ["past_customers", "past_customers_unknown"],
  ["monthly_leads", "monthly_leads_unknown"],
];

for (const [field, unknownField] of AUDIENCE) {
  const value = input[field];
  const unknown = input[unknownField];
  const meaning =
    unknown === true
      ? "they said NOT SURE  -> benchmarks"
      : value === null
        ? "skipped             -> benchmarks"
        : value === 0
          ? "answered ZERO       -> plan for no audience"
          : "answered";
  console.log(`  ${field.padEnd(22)} ${String(format(value)).padEnd(10)} ${meaning}`);

  /**
   * The failure this script exists for. "Not sure" must store null plus the
   * flag; a 0 alongside the flag means the clearing broke, and the generator
   * would plan for a business with no audience.
   */
  if (unknown === true && value !== null) {
    problems.push(
      `${field}: "Not sure" is ticked but the value is ${value}, should be null`
    );
  }
}

show("borrowed_audiences", input.borrowed_audiences);

console.log("\n=== SCREEN 9 ===\n");
show("challenges", input.challenges);
show("challenge_notes", truncate(input.challenge_notes));

if (Array.isArray(input.challenges) && input.challenges.length > 3) {
  problems.push(`challenges has ${input.challenges.length} entries, cap is 3`);
}

/* ---------------- Products ---------------- */

const { data: products } = await db
  .from("intake_products")
  .select("*")
  .eq("planning_input_id", input.id)
  .order("display_order");

console.log(`\n=== PRODUCTS (${products?.length ?? 0}) ===\n`);

for (const product of products ?? []) {
  const goal = (Number(product.average_price) || 0) * (Number(product.units_in_period) || 0);
  console.log(
    `  ${String(product.name || "(unnamed)").padEnd(28)} ` +
      `${String(product.price_level ?? "-").padEnd(11)} ` +
      `${String(product.payment_type ?? "-").padEnd(13)} ` +
      `${money(product.average_price)} x ${product.units_in_period ?? "-"} = ${money(goal)}`
  );

  // Recurring reveals the interval; a blank one means the revealed field was
  // ignored, and a stale one means it was not cleared on switching away.
  if (product.payment_type === "recurring" && !product.recurring_interval) {
    problems.push(`product "${product.name}": recurring but no interval`);
  }
  if (product.payment_type !== "recurring" && product.recurring_interval) {
    problems.push(
      `product "${product.name}": not recurring but interval "${product.recurring_interval}" survived`
    );
  }
}

/* ---------------- Initiatives ---------------- */

const { data: initiatives } = await db
  .from("intake_initiatives")
  .select("*")
  .eq("planning_input_id", input.id)
  .order("source")
  .order("display_order");

console.log(`\n=== INITIATIVES (${initiatives?.length ?? 0}) ===\n`);

for (const initiative of initiatives ?? []) {
  const stages = Array.isArray(initiative.funnel_stages) ? initiative.funnel_stages : [];
  const filled = stages.filter((s) => s && s.percent !== null).length;

  console.log(
    `  [${String(initiative.source).padEnd(7)}] ${String(
      initiative.initiative_label || initiative.initiative_key
    ).padEnd(30)} ` +
      `products=${(initiative.product_ids ?? []).length} ` +
      `cadence=${initiative.cadence ?? "-"} ` +
      `ran_before=${initiative.has_run_before ?? "-"} ` +
      `funnel=${filled}/${stages.length}`
  );

  if (initiative.funnel_stages && stages.length > 0) {
    const perRun = forecastPerRun(initiative);
    console.log(
      `             audience=${initiative.audience_reached ?? "null"} ` +
        stages.map((s) => `${s.key}=${s.percent ?? "null"}%`).join(" ") +
        ` price=${initiative.average_price ?? "null"}` +
        `  ->  ${perRun === null ? "NO FORECAST (benchmarks)" : money(perRun) + " per run"}`
    );
  }

  // Screen 5 requires both; screen 6 rows legitimately have neither.
  if (initiative.source === "planned") {
    if (!initiative.initiative_key) {
      problems.push("a planned initiative has no initiative_key");
    }
    if ((initiative.product_ids ?? []).length === 0) {
      problems.push(
        `planned "${initiative.initiative_label || initiative.initiative_key}" sells no product`
      );
    }
    if (initiative.cadence === "repeat" && !initiative.repeat_frequency) {
      problems.push(
        `planned "${initiative.initiative_label}": on repeat but no frequency`
      );
    }
  }

  // The "Something else" escape hatch must be flagged for review.
  if (initiative.custom_label && !initiative.needs_review) {
    problems.push(
      `"${initiative.custom_label}" has a custom label but needs_review is false`
    );
  }
}

// The same initiative cannot be both a win and a flop — the generator would
// get contradictory guidance.
const worked = new Set(
  (initiatives ?? []).filter((i) => i.source === "worked").map((i) => i.initiative_key)
);
for (const failed of (initiatives ?? []).filter((i) => i.source === "failed")) {
  if (worked.has(failed.initiative_key)) {
    problems.push(`${failed.initiative_key} is listed as BOTH a win and a flop`);
  }
}

/* ---------------- What the build produced ---------------- */

if (input.company_id) {
  const [{ data: liveProducts }, { data: liveInitiatives }] = await Promise.all([
    db.from("products").select("name, price").eq("company_id", input.company_id),
    db
      .from("initiatives")
      .select("name, activation_date, product_id")
      .eq("company_id", input.company_id)
      .order("activation_date"),
  ]);

  console.log(
    `\n=== AFTER "BUILD MY PLAN" ` +
      `(${liveProducts?.length ?? 0} products, ${liveInitiatives?.length ?? 0} initiatives) ===\n`
  );

  for (const initiative of liveInitiatives ?? []) {
    console.log(`  ${initiative.activation_date}  ${initiative.name}`);
  }

  if ((liveInitiatives?.length ?? 0) === 0 && input.completed_at) {
    problems.push(
      "the intake is marked complete but no live initiatives exist — the build failed"
    );
  }

  /**
   * Expected, not a bug: initiatives.product_id is a single NOT NULL column
   * while screen 5 allows several products, so a two-product initiative
   * becomes two rows. Called out here so it is not mistaken for duplication.
   */
  const names = (liveInitiatives ?? []).map((i) => i.name);
  const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicated.length > 0) {
    console.log(
      `\n  Note: ${[...new Set(duplicated)].join(", ")} appears more than once.\n` +
        "  That is expected for an initiative selling several products — one row\n" +
        "  per product, so revenue stays attributable. Confirm it is what Rachel wants.\n"
    );
  }
}

/* ---------------- Analytics ---------------- */

const { data: events } = await db
  .from("intake_events")
  .select("event, screen, plan_path, properties, created_at")
  .order("created_at", { ascending: false })
  .limit(20);

console.log(`\n=== RECENT EVENTS (${events?.length ?? 0}) ===\n`);
for (const event of events ?? []) {
  console.log(
    `  ${event.created_at.slice(11, 19)}  ${String(event.event).padEnd(28)} ` +
      `${String(event.screen ?? "-").padEnd(13)} ${JSON.stringify(event.properties ?? {})}`
  );
}
if ((events?.length ?? 0) === 0) {
  console.log(
    "  Nothing recorded. Events are fire-and-forget, so a failure is silent —\n" +
      "  check for [intake/events] lines in the dev server output.\n"
  );
}

/* ---------------- Verdict ---------------- */

console.log("\n" + "=".repeat(64));
if (problems.length === 0) {
  console.log("\nNo data problems found.\n");
} else {
  console.log(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log("");
}

// Explicit exit: the Supabase client keeps a handle open, which makes Node
// print a libuv assertion on Windows during teardown. Nothing is pending by
// this point, so exiting is safe and keeps the output clean.
process.exit(problems.length === 0 ? 0 : 1);

/* ---------------- Helpers ---------------- */

/** Mirrors lib/intake-forecast.ts: any blank stage means NO forecast, not zero. */
function forecastPerRun(initiative) {
  const audience = Number(initiative.audience_reached);
  const price = Number(initiative.average_price);
  const stages = Array.isArray(initiative.funnel_stages) ? initiative.funnel_stages : [];

  if (!audience || !price || stages.length === 0) return null;
  if (stages.some((s) => !s || s.percent === null)) return null;

  return stages.reduce((people, s) => people * (Number(s.percent) / 100), audience) * price;
}

function money(value) {
  const n = Number(value) || 0;
  return "$" + Math.round(n).toLocaleString("en-US");
}

function truncate(value) {
  if (typeof value !== "string") return value;
  return value.length > 60 ? value.slice(0, 57) + "..." : value;
}
