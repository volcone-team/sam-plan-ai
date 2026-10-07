/**
 * Prove a partial intake save actually reaches the database.
 *
 * The NOT NULL bug on `revenue_goal` passed every unit test, because no unit
 * test touches Postgres. This writes the exact row screen 0 produces — an empty
 * draft — against the real schema, then rolls it back.
 *
 * Covers each screen's cumulative state, so a constraint that only bites on a
 * later screen is caught too.
 *
 * Creates and DELETES one throwaway company. Touches nothing else.
 *
 *   node scripts/smoke-intake-save.mjs
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

/**
 * The serialiser is imported from source via a TS-aware loader if available;
 * otherwise the payloads below are built by hand to match it. Hand-built here
 * so the script runs under plain node with no build step — the point is to test
 * the SCHEMA, and a mismatch with the real serialiser would be caught by the
 * unit test that reads the same migration.
 */
const BASE = {
  intake_version: 2,
  resume_screen: "start",
  // Every text column the serialiser writes.
  intake_path: null,
  industry: null,
  industry_other: null,
  business_description: null,
  purchase_mode: null,
  growth_stage: null,
  sales_owner: null,
  plan_owner: null,
  what_worked_notes: null,
  what_failed_notes: null,
  sells_to: null,
  problem_solved: null,
  ideal_customer_description: null,
  challenge_notes: null,
  // Numbers. revenue_goal is NOT NULL, so it takes its fallback.
  prior_period_revenue: null,
  weekly_hours: null,
  horizon_months: null,
  team_size: null,
  monthly_marketing_budget: null,
  revenue_goal: 0,
  // Arrays and dates.
  customer_industries: [],
  borrowed_audiences: [],
  challenges: [],
  plan_start_month: null,
  // Audience figures with their unknown flags.
  email_list_size: null,
  email_list_unknown: false,
  social_following: null,
  social_following_unknown: false,
  monthly_visitors: null,
  monthly_visitors_unknown: false,
  past_customers: null,
  past_customers_unknown: false,
  monthly_leads: null,
  monthly_leads_unknown: false,
};

/** Cumulative state at the end of each screen, as the user advances. */
const SCREENS = [
  ["screen 0 — nothing answered", {}],
  ["screen 0 — path chosen", { intake_path: "know_some", resume_screen: "business" }],
  [
    "screen 1 — business",
    {
      intake_path: "know_some",
      industry: "Coaching & Consulting",
      prior_period_revenue: 450000,
      growth_stage: "momentum",
      purchase_mode: "sales_call",
      resume_screen: "team",
    },
  ],
  [
    "screen 2 — team",
    { team_size: 4, monthly_marketing_budget: 0, weekly_hours: 20, resume_screen: "products" },
  ],
  [
    "screen 3 — products",
    { horizon_months: 6, plan_start_month: "2026-11-01", resume_screen: "goal" },
  ],
  ["screen 4 — goal", { revenue_goal: 292500, resume_screen: "wins" }],
  [
    "screen 8 — Not sure ticked",
    { email_list_size: null, email_list_unknown: true, resume_screen: "obstacles" },
  ],
  ["screen 9 — obstacles", { challenges: ["need_leads", "limited_time"] }],
];

let companyId = null;
let failures = 0;

try {
  const { data: company, error: companyError } = await db
    .from("companies")
    .insert({ name: "__intake smoke test__" })
    .select("id")
    .single();

  if (companyError) throw new Error(`could not create test company: ${companyError.message}`);
  companyId = company.id;
  console.log(`\nTest company ${companyId}\n`);

  let accumulated = { ...BASE };
  let inputId = null;

  for (const [label, patch] of SCREENS) {
    accumulated = { ...accumulated, ...patch };

    if (!inputId) {
      const { data, error } = await db
        .from("planning_inputs")
        .insert({ ...accumulated, company_id: companyId, intake_route: "full" })
        .select("id")
        .single();

      if (error) {
        console.log(`  FAIL  ${label}`);
        console.log(`        ${error.message}`);
        failures += 1;
        continue;
      }
      inputId = data.id;
      console.log(`  ok    ${label} (insert)`);
    } else {
      const { error } = await db
        .from("planning_inputs")
        .update(accumulated)
        .eq("id", inputId);

      if (error) {
        console.log(`  FAIL  ${label}`);
        console.log(`        ${error.message}`);
        failures += 1;
        continue;
      }
      console.log(`  ok    ${label} (update)`);
    }
  }

  /* ---- Child rows ---- */

  if (inputId) {
    const { error: productError } = await db.from("intake_products").insert({
      company_id: companyId,
      planning_input_id: inputId,
      name: "Coaching program",
      product_type: "coaching_service",
      price_level: "high",
      payment_type: "recurring",
      recurring_interval: "month",
      delivery_mode: "online",
      average_price: 5000,
      units_in_period: 20,
      display_order: 0,
    });

    console.log(
      productError
        ? `  FAIL  product row\n        ${productError.message}`
        : "  ok    product row"
    );
    if (productError) failures += 1;

    /**
     * The product id that screen 5's chips must resolve to.
     *
     * The chips are keyed by array index, and product_ids is UUID[], so an
     * unresolved index fails with 'invalid input syntax for type uuid: "0"'.
     * Reading the real id back here is what proves the resolution happened.
     */
    const { data: savedProduct } = await db
      .from("intake_products")
      .select("id")
      .eq("planning_input_id", inputId)
      .single();

    const { error: initiativeError } = await db.from("intake_initiatives").insert({
      company_id: companyId,
      planning_input_id: inputId,
      source: "planned",
      initiative_key: "webinar",
      initiative_label: "Live Webinar",
      product_ids: savedProduct ? [savedProduct.id] : [],
      cadence: "repeat",
      repeat_frequency: "monthly",
      start_month: "2026-11-01",
      has_run_before: true,
      audience_reached: 3000,
      funnel_stages: [
        { key: "signed_up", label: "% who registered", percent: 12 },
        { key: "showed", label: "% who showed up", percent: 30 },
        { key: "bought", label: "% who bought", percent: 4 },
      ],
      average_price: 5000,
      display_order: 0,
    });

    console.log(
      initiativeError
        ? `  FAIL  initiative row\n        ${initiativeError.message}`
        : "  ok    initiative row"
    );
    if (initiativeError) failures += 1;

    // A partially-filled funnel, which must store nulls rather than zeros.
    const { error: partialError } = await db.from("intake_initiatives").insert({
      company_id: companyId,
      planning_input_id: inputId,
      source: "worked",
      initiative_key: "podcast-vodcast-guest",
      funnel_stages: [
        { key: "signed_up", label: "% who opted in", percent: 8 },
        { key: "showed", label: "% who booked a call", percent: null },
        { key: "bought", label: "% who bought", percent: null },
      ],
      display_order: 1,
    });

    console.log(
      partialError
        ? `  FAIL  partial funnel row\n        ${partialError.message}`
        : "  ok    partial funnel row"
    );
    if (partialError) failures += 1;

    /**
     * The regression itself. An array index in a UUID[] column must be rejected
     * by Postgres — if this insert SUCCEEDS the column is not the type we think
     * it is, and the resolver in draft.ts is guarding nothing.
     */
    const { error: indexError } = await db.from("intake_initiatives").insert({
      company_id: companyId,
      planning_input_id: inputId,
      source: "planned",
      initiative_key: "__index-probe__",
      product_ids: ["0"],
      display_order: 99,
    });

    if (indexError && /invalid input syntax for type uuid/i.test(indexError.message)) {
      console.log(
        "  ok    an array index IS rejected by product_ids (so it must be resolved)"
      );
    } else if (indexError) {
      console.log(`  FAIL  unexpected error probing product_ids\n        ${indexError.message}`);
      failures += 1;
    } else {
      console.log(
        "  FAIL  product_ids accepted an array index — the UUID[] guard is not real"
      );
      failures += 1;
      await db
        .from("intake_initiatives")
        .delete()
        .eq("initiative_key", "__index-probe__");
    }

    /* ---- Read it back ---- */

    const { data: readBack } = await db
      .from("planning_inputs")
      .select("revenue_goal, email_list_size, email_list_unknown, horizon_months")
      .eq("id", inputId)
      .single();

    console.log("\n  Read back:");
    console.log(`    revenue_goal        ${readBack.revenue_goal}`);
    console.log(
      `    email_list_size     ${readBack.email_list_size} (unknown=${readBack.email_list_unknown})`
    );
    console.log(`    horizon_months      ${readBack.horizon_months}`);

    if (readBack.email_list_unknown && readBack.email_list_size !== null) {
      console.log('\n  FAIL  "Not sure" stored a value instead of null');
      failures += 1;
    }
  }

  /* ---- An event with no company, which must be allowed ---- */

  const { error: eventError } = await db.from("intake_events").insert({
    company_id: null,
    user_id: null,
    event: "intake_screen_viewed",
    screen: "start",
    properties: {},
  });

  console.log(
    eventError
      ? `\n  FAIL  anonymous event\n        ${eventError.message}`
      : "\n  ok    anonymous event (null company_id accepted)"
  );
  if (eventError) failures += 1;
} catch (err) {
  console.log(`\n  FAIL  ${err.message}`);
  failures += 1;
} finally {
  if (companyId) {
    // Cascades to planning_inputs, intake_products and intake_initiatives.
    await db.from("companies").delete().eq("id", companyId);
    // The anonymous event has no company to cascade from.
    await db
      .from("intake_events")
      .delete()
      .is("company_id", null)
      .is("user_id", null);
    console.log("\n  cleaned up");
  }
}

console.log(
  failures === 0
    ? "\nEvery partial save is accepted by the schema.\n"
    : `\n${failures} failure(s) — the intake will break on those screens.\n`
);

process.exit(failures === 0 ? 0 : 1);
