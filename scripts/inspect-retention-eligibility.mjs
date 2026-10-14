/**
 * Why is the retention discount being refused?
 *
 * The customer-facing message is deliberately vague — it must not invite
 * haggling, and it must not tell an annual subscriber that switching to monthly
 * would unlock a discount. That makes it useless for debugging, so this script
 * reports the ACTUAL blocker for every company, in the same order
 * canOfferDiscount checks them.
 *
 * Read-only. Usage: node scripts/inspect-retention-eligibility.mjs [email]
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

const wanted = (process.argv[2] || "").trim().toLowerCase();

const STRIPE_MODE_TAG = "live";

// ---------------------------------------------------------------
// Does the table the route reads first even exist?
// ---------------------------------------------------------------
const { error: tableError } = await db
  .from("retention_offer_redemptions")
  .select("id")
  .limit(1);

console.log("\n=== Migration 031 ===");
if (tableError) {
  console.log(`  retention_offer_redemptions MISSING — ${tableError.message}`);
  console.log(
    "  NOTE: with the table absent the route returns 503 redemptions_unavailable,\n" +
    '        which the UI shows as "We could not confirm the offer just now."\n' +
    '        That is NOT the "not available on your plan" message.'
  );
} else {
  console.log("  retention_offer_redemptions present");
}

// ---------------------------------------------------------------
// Per-company eligibility
// ---------------------------------------------------------------
const { data: subs } = await db
  .from("subscriptions")
  .select(
    "company_id, plan_id, status, stripe_status, stripe_subscription_id, " +
    "stripe_price_id, stripe_mode, billing_cycle, current_period_end, " +
    "cancel_at_period_end, is_comped, is_paused"
  );

const { data: profiles } = await db
  .from("profiles")
  .select("company_id, email, role");

const { data: prices } = await db
  .from("stripe_prices")
  .select("stripe_price_id, unit_amount, billing_cycle, is_current, plan_id, stripe_mode");

const { data: redemptions } = tableError
  ? { data: [] }
  : await db.from("retention_offer_redemptions").select("company_id, offer_id");

const ownerByCompany = new Map();
for (const p of profiles ?? []) {
  if (!ownerByCompany.has(p.company_id) || p.role === "owner") {
    ownerByCompany.set(p.company_id, p.email);
  }
}
const priceById = new Map((prices ?? []).map((p) => [p.stripe_price_id, p]));
const redeemed = new Set((redemptions ?? []).map((r) => r.company_id));

/** Mirrors canCancel in src/lib/billing/cancellation.ts. */
function cancelBlocker(sub) {
  const status = sub.stripe_status ?? sub.status;
  const hasStripe =
    !!sub.stripe_subscription_id && sub.stripe_mode === STRIPE_MODE_TAG;
  if (sub.is_paused) return "paused";
  if (sub.is_comped) return "comped";
  if (status === "canceled" || status === "cancelled") return "already_canceled";
  if (!hasStripe) {
    return status === "trialing" || status === "trial" ? "trialing" : "nothing_to_cancel";
  }
  if (sub.cancel_at_period_end) return "already_ending";
  return null;
}

/**
 * Which offers exist per cycle. Mirrors DISCOUNT_OFFERS[].cycles — kept in sync
 * by hand because this script is plain .mjs and cannot import the TS module.
 */
const OFFERS_BY_CYCLE = {
  monthly: ["free_month", "half_off_two_months"],
  annual: ["annual_month_free"],
};

/** Mirrors canOfferDiscount (the availability form, with no chosen offer). */
function discountBlocker(sub) {
  const cancel = cancelBlocker(sub);
  if (cancel) return { blocker: "not_eligible_to_cancel", because: cancel };

  const forCycle = OFFERS_BY_CYCLE[sub.billing_cycle] ?? [];
  if (forCycle.length === 0) {
    return {
      blocker: "no_offer_for_cycle",
      because: `no offer defined for billing_cycle = ${sub.billing_cycle}`,
    };
  }
  // hasExistingDiscount needs Stripe and is not checked here.
  if (redeemed.has(sub.company_id)) {
    return { blocker: "already_redeemed", because: "a redemption row exists" };
  }
  const price = priceById.get(sub.stripe_price_id);
  if (!price || !(price.unit_amount > 0)) {
    return {
      blocker: "no_price",
      because: sub.stripe_price_id
        ? `no stripe_prices row matches stripe_price_id ${sub.stripe_price_id} in mode '${STRIPE_MODE_TAG}'`
        : "subscription has no stripe_price_id",
    };
  }
  return null;
}

console.log("\n=== Discount eligibility by company ===");

let shown = 0;
for (const sub of subs ?? []) {
  const email = ownerByCompany.get(sub.company_id) ?? "(no profile)";
  if (wanted && !email.toLowerCase().includes(wanted)) continue;
  shown++;

  const result = discountBlocker(sub);
  const status = sub.stripe_status ?? sub.status;

  console.log(`\n  ${email}`);
  console.log(`    company          ${sub.company_id}`);
  console.log(`    status           ${status}`);
  console.log(`    billing_cycle    ${sub.billing_cycle}`);
  console.log(`    stripe_sub       ${sub.stripe_subscription_id ?? "none"}`);
  console.log(`    stripe_mode      ${sub.stripe_mode ?? "none"}`);
  console.log(`    stripe_price_id  ${sub.stripe_price_id ?? "none"}`);
  console.log(`    ending?          ${sub.cancel_at_period_end}`);
  console.log(`    comped / paused  ${sub.is_comped} / ${sub.is_paused}`);

  const price = priceById.get(sub.stripe_price_id);
  console.log(
    `    price row        ${
      price
        ? `${price.unit_amount} minor, cycle ${price.billing_cycle}, current ${price.is_current}, mode ${price.stripe_mode}`
        : "NOT FOUND"
    }`
  );

  const offersHere = OFFERS_BY_CYCLE[sub.billing_cycle] ?? [];
  console.log(`    offers for cycle ${offersHere.join(", ") || "none"}`);

  if (!result) {
    console.log("    => ELIGIBLE (subject to Stripe having no existing discount)");
  } else {
    console.log(`    => REFUSED: ${result.blocker}  (${result.because})`);
    if (
      result.blocker === "no_offer_for_cycle" ||
      result.blocker === "no_price" ||
      result.blocker === "not_eligible_to_cancel"
    ) {
      console.log(
        '       This is the one the UI reports as "not available on your plan".'
      );
    }
  }
}

if (shown === 0) {
  console.log(
    wanted
      ? `\n  No company found for an owner email containing "${wanted}".`
      : "\n  No subscriptions found."
  );
}

console.log("");
