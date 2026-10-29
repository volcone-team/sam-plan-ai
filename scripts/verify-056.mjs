/**
 * Is migration 056 (university_resources.billing_cycle) applied?
 *
 * READ-ONLY. Selects the new column and reports how resources are split
 * between any / monthly / annual. Writes nothing.
 *
 * Exits 1 when the column is missing.
 *
 * Usage: node scripts/verify-056.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\nSAM University billing-cycle visibility (migration 056)\n");
const { data, error } = await db.from("university_resources").select("billing_cycle");
if (error) {
  console.log("  MISSING  university_resources.billing_cycle");
  console.log(`           ${error.message}`);
  console.log(
    "\nmigration not applied — run supabase/migrations/056_university_billing_cycle.sql\n" +
      "in the Supabase SQL editor. Until then every resource shows to both cycles,\n" +
      "and the admin form refuses 'Annual only' / 'Monthly only'.\n"
  );
  process.exit(1);
}
const rows = data ?? [];
const count = (v) => rows.filter((r) => r.billing_cycle === v).length;
console.log("  ok       university_resources.billing_cycle");
console.log(`           ${rows.length} resources: ${count("any")} any, ${count("annual")} annual only, ${count("monthly")} monthly only\n`);
