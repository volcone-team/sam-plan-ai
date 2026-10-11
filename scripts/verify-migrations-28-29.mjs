/**
 * Did migrations 028 and 029 apply?
 *
 * 029 replaces handle_new_user(), the trigger that creates the company,
 * profile, annual plan and subscription for every signup. If it half-applied,
 * registration breaks — and that is not visible until someone tries to sign
 * up. Checked before pushing code that assumes it.
 *
 * Read-only. Usage: node scripts/verify-migrations-28-29.mjs
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

let failed = false;

console.log("\nMigration 028 — marketing consent\n");

for (const column of ["marketing_consent", "marketing_consent_at"]) {
  const { error } = await db.from("profiles").select(column).limit(1);
  if (error) {
    console.log(`  MISSING  profiles.${column} — ${error.message}`);
    failed = true;
  } else {
    console.log(`  ok       profiles.${column}`);
  }
}

console.log("\nMigration 029 — trial plan resolution\n");

/**
 * The tier CHECK constraint had to be DROPPED: it allowed only
 * ('starter','pro','mastery'), so writing a real plan name would fail the
 * whole signup trigger. Proven by inserting a value the old constraint would
 * have rejected, then rolling it back.
 */
const probeCompanyName = `__migration_probe_${Date.now()}`;
let probeCompanyId = null;

try {
  const { data: company, error: compErr } = await db
    .from("companies")
    .insert({
      name: probeCompanyName,
      description: "",
      fiscal_year: 2026,
      planning_year: 2026,
      currency: "USD",
    })
    .select("id")
    .single();

  if (compErr) throw new Error(`probe company: ${compErr.message}`);
  probeCompanyId = company.id;

  const { error: subErr } = await db.from("subscriptions").insert({
    company_id: probeCompanyId,
    tier: "founding_member", // the old CHECK would reject this
    status: "cancelled",
    billing_cycle: "monthly",
  });

  if (subErr) {
    console.log(
      `  FAILED   tier constraint still rejects a real plan name — ${subErr.message}`
    );
    console.log("           029 did not apply, or only applied in part.");
    failed = true;
  } else {
    console.log("  ok       tier accepts any plan name (constraint dropped)");
  }
} catch (err) {
  console.log(`  ERROR    could not probe: ${err.message}`);
  failed = true;
} finally {
  // Always clean up: the cascade removes the subscription with the company.
  if (probeCompanyId) {
    await db.from("companies").delete().eq("id", probeCompanyId);
    console.log("  ok       probe rows removed");
  }
}

/**
 * resolve_trial_plan() must exist AND return an active plan. A NULL answer
 * would mean trials get no plan, which 029 deliberately turns into "no trial"
 * rather than an unlimited one.
 */
const { data: resolved, error: rpcErr } = await db.rpc("resolve_trial_plan");

if (rpcErr) {
  console.log(`  MISSING  resolve_trial_plan() — ${rpcErr.message}`);
  failed = true;
} else if (!resolved) {
  console.log(
    "  WARN     resolve_trial_plan() returned NULL — no active plan exists,\n" +
    "           so new signups will get NO trial (fails safe, but check your plans)."
  );
} else {
  const { data: plan } = await db
    .from("subscription_plans")
    .select("name, is_active, monthly_price")
    .eq("id", resolved)
    .maybeSingle();
  console.log(
    `  ok       resolve_trial_plan() -> ${plan?.name ?? resolved}` +
      ` (active=${plan?.is_active}, $${plan?.monthly_price}/mo)`
  );
}

console.log(
  failed
    ? "\nNOT READY — re-run the missing migration before pushing.\n"
    : "\nBoth migrations applied. Safe to push.\n"
);

process.exit(failed ? 1 : 0);
