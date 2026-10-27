/**
 * Is migration 055 (products.recurring_interval) applied?
 *
 * READ-ONLY. Selects the new column and reports how recurring products are
 * split between month, year and unrecorded. Writes nothing.
 *
 * Exits 1 when the column is missing.
 *
 * Usage: node scripts/verify-055.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\nProduct recurring interval (migration 055)\n");
const { data, error } = await db.from("products").select("revenue_type, recurring_interval");
if (error) {
  console.log("  MISSING  products.recurring_interval");
  console.log(`           ${error.message}`);
  console.log(
    "\nmigration not applied — run supabase/migrations/055_product_recurring_interval.sql\n" +
      "in the Supabase SQL editor. Until then the Products page saves without the\n" +
      "interval and every recurring product reads as monthly.\n"
  );
  process.exit(1);
}
const recurring = (data ?? []).filter((r) => r.revenue_type === "recurring");
const count = (v) => recurring.filter((r) => r.recurring_interval === v).length;
console.log("  ok       products.recurring_interval");
console.log(
  `           ${recurring.length} recurring products: ${count("month")} monthly, ${count("year")} yearly, ` +
    `${recurring.length - count("month") - count("year")} unrecorded (read as monthly)\n`
);
