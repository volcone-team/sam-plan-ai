/**
 * Does the database have what recurring initiatives need, and what is stored?
 *
 * Read-only. Usage: node scripts/verify-initiative-recurrence.mjs
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

console.log("\nInitiative recurrence (migration 036)\n");

let failed = false;

const { error: columnError } = await db
  .from("initiatives")
  .select("repeat_frequency")
  .limit(1);

if (columnError) {
  console.log(`  MISSING  initiatives.repeat_frequency — ${columnError.message}`);
  failed = true;
} else {
  console.log("  ok       initiatives.repeat_frequency exists");
}

/* ---- What is actually stored ---- */

const { data: rows } = await db
  .from("initiatives")
  .select("company_id, annual_plan_id, initiative_type_id, name, kind, repeat_frequency");

if (rows) {
  const byKind = new Map();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);

  console.log(`\n  ${rows.length} initiatives by kind:`);
  for (const [kind, count] of byKind) console.log(`    ${kind}: ${count}`);

  /**
   * THE CONTRADICTION THIS MIGRATION CLOSES, reported directly.
   *
   * A recurring initiative with no frequency cannot be scheduled or described.
   * Rows created before 036 are expected here; rows created after it are a bug.
   */
  if (!columnError) {
    const recurringNoFreq = rows.filter(
      (r) => r.kind === "recurring" && !r.repeat_frequency
    );
    console.log(
      recurringNoFreq.length === 0
        ? "\n  ok       every recurring initiative has a frequency"
        : `\n  WARN     ${recurringNoFreq.length} recurring initiative(s) have no frequency` +
          " (expected for rows built before this migration):\n" +
          recurringNoFreq.map((r) => `             ${r.name}`).join("\n")
    );
  }

  /**
   * The cap the client stated: 3-5 per plan, counted as INITIATIVES rather
   * than rows. Rows are split per product, so the distinct initiative_type
   * count is the number that should be compared against the cap.
   */
  const byPlan = new Map();
  for (const r of rows) {
    const arr = byPlan.get(r.annual_plan_id) ?? [];
    arr.push(r);
    byPlan.set(r.annual_plan_id, arr);
  }

  console.log("\n  per plan (cap is 5 initiatives, not 5 rows):");
  for (const [plan, planRows] of byPlan) {
    const distinct = new Set(planRows.map((r) => r.initiative_type_id)).size;
    const flag = distinct > 5 ? "  OVER CAP" : "";
    console.log(
      `    ${String(plan).slice(0, 8)}: ${planRows.length} rows, ${distinct} initiatives${flag}`
    );
  }
}

/* ---- The occurrence model, still unimplemented ---- */

const { count: templates, error: templateError } = await db
  .from("recurring_templates")
  .select("id", { count: "exact", head: true });

console.log(
  templateError
    ? `\n  recurring_templates: unreadable — ${templateError.message}`
    : `\n  recurring_templates: ${templates ?? 0} rows` +
      (templates ? "" : " (specified in migration 001, never implemented)")
);

console.log(
  failed
    ? "\nNOT READY — apply supabase/migrations/036_initiative_repeat_frequency.sql first.\n"
    : "\nReady.\n"
);

process.exit(failed ? 1 : 0);
