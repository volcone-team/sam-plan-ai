/**
 * Is migration 060 (per-plan onboarding calendar links) applied?
 *
 * READ-ONLY. Selects the new subscription_plans columns and lists each plan's
 * links. Exits 1 when the columns are missing.
 *
 * Usage: node scripts/verify-060.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\nPer-plan onboarding calendar links (migration 060)\n");
const { data, error } = await db
  .from("subscription_plans")
  .select("name, onboarding_call_url_monthly, onboarding_call_url_yearly")
  .order("display_order");
if (error) {
  console.log("  MISSING  subscription_plans.onboarding_call_url_monthly / _yearly");
  console.log(`           ${error.message}`);
  console.log(
    "\nmigration not applied — run supabase/migrations/060_plan_onboarding_links.sql in\n" +
      "the Supabase SQL editor. Until then /welcome uses the Onboarding Call tab links.\n"
  );
  process.exit(1);
}
console.log("  ok       subscription_plans.onboarding_call_url_monthly / _yearly");
for (const p of data ?? []) {
  console.log(`           ${p.name}: monthly ${p.onboarding_call_url_monthly ?? "(global)"}, yearly ${p.onboarding_call_url_yearly ?? "(global)"}`);
}
console.log("");
