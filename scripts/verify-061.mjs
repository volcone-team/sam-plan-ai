/**
 * Is migration 061 (initiative targets, product goals, template sections)
 * applied?
 *
 * READ-ONLY. Selects each new column and reports how many rows already use
 * it. Writes nothing. CHECK constraints are not visible from here; the SQL to
 * confirm them by hand is printed at the end.
 *
 * Exits 1 when any column is missing.
 *
 * Usage: node scripts/verify-061.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\nInitiative targets, product goals, template sections (migration 061)\n");

const checks = [
  ["initiatives", "units_goal, unit_price_at_set, target_source, revenue_per_occurrence, last_occurrence_date", "units_goal"],
  ["products", "goal_units", "goal_units"],
  ["wb_task_templates", "section", "section"],
];

let missing = 0;
for (const [table, columns, countColumn] of checks) {
  const { data, error } = await db.from(table).select(columns).limit(5000);
  if (error) {
    missing += 1;
    console.log(`  MISSING  ${table}: ${columns}`);
    console.log(`           ${error.message}`);
    continue;
  }
  const rows = data ?? [];
  const filled = rows.filter((r) => r[countColumn] !== null && r[countColumn] !== undefined).length;
  console.log(`  ok       ${table}: ${columns}`);
  console.log(`           ${rows.length} rows, ${filled} with ${countColumn} set`);
}

if (missing > 0) {
  console.log(
    "\nmigration not applied — run supabase/migrations/061_initiative_targets.sql\n" +
      "in the Supabase SQL editor. Until then targets stay dollar-only and\n" +
      "recurring series are bounded by the close date, as before.\n"
  );
  process.exit(1);
}

console.log(
  "\nApplied. Confirm the CHECKs by hand if wanted:\n" +
    "  SELECT conname FROM pg_constraint WHERE conname IN (\n" +
    "    'initiatives_units_goal_check','initiatives_unit_price_at_set_check',\n" +
    "    'initiatives_target_source_check','initiatives_revenue_per_occurrence_check',\n" +
    "    'products_goal_units_check');  -- expect 5 rows\n"
);
