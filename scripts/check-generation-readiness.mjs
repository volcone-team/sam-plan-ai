/**
 * Read-only pre-flight check for plan generation.
 *
 * Generation fails or degrades for reasons that have nothing to do with the
 * request itself: an empty initiative library, missing task templates, a
 * malformed Anthropic key. This checks each of those directly so a failure can
 * be attributed before spending a Claude call on it.
 *
 * READS ONLY. Creates nothing, writes nothing, and never prints a secret —
 * keys are reported as present/absent and by shape, not by value.
 *
 *   node scripts/check-generation-readiness.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Load .env.local without adding a dependency.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

let failures = 0;
const fail = (m) => { failures += 1; console.log("  FAIL  " + m); };
const pass = (m) => console.log("  ok    " + m);
const warn = (m) => console.log("  warn  " + m);

console.log("\nPlan generation readiness\n");

// 1. Anthropic key — shape only. generate-plan rejects anything not starting
//    sk-ant- before it calls Claude, so a malformed key fails every generation.
console.log("Anthropic");
if (!anthropicKey) fail("ANTHROPIC_API_KEY is not set");
else if (!anthropicKey.startsWith("sk-ant-")) fail("ANTHROPIC_API_KEY is malformed (must start sk-ant-)");
else pass(`ANTHROPIC_API_KEY present, well-formed (${anthropicKey.length} chars)`);

const db = createClient(url, key);

// 2. The initiative library IS the brain. The prompt instructs the model to
//    select libraryKeys verbatim from it; empty means nothing valid to choose.
console.log("\nWorkbook");
const { data: library, error: libErr } = await db
  .from("wb_initiative_library")
  .select("initiative_key, name, difficulty");

if (libErr) {
  fail(`wb_initiative_library unreadable: ${libErr.message}`);
} else if (!library?.length) {
  fail("wb_initiative_library is EMPTY — generation has no initiatives to pick from");
} else {
  pass(`wb_initiative_library: ${library.length} initiatives`);

  const { data: templates, error: tErr } = await db
    .from("wb_task_templates")
    .select("initiative_key");

  if (tErr) {
    warn(`wb_task_templates unreadable: ${tErr.message}`);
  } else {
    const withTemplates = new Set((templates ?? []).map((t) => t.initiative_key));
    const covered = library.filter((l) => withTemplates.has(l.initiative_key)).length;
    if (covered === 0) {
      warn(`no task templates — tasks fall back to AI-generated ones (${library.length} uncovered)`);
    } else {
      pass(`task templates cover ${covered}/${library.length} initiatives`);
    }
  }
}

// 3. initiative_types is the display/catalogue side. generate-plan creates rows
//    on demand from the library, so empty is survivable, not fatal.
const { count: typeCount } = await db
  .from("initiative_types")
  .select("id", { count: "exact", head: true })
  .eq("is_active", true);
if (!typeCount) warn("initiative_types is empty (generation creates them on demand)");
else pass(`initiative_types: ${typeCount} active`);

// 4. Does any account actually have the prerequisites to generate? Generation
//    needs a company, an annual_plan to write into, and an owner/operator.
console.log("\nAccounts");
const { count: companies } = await db
  .from("companies").select("id", { count: "exact", head: true });
const { count: plans } = await db
  .from("annual_plans").select("id", { count: "exact", head: true });

if (!companies) {
  warn("no companies — register a user before generating");
} else {
  pass(`${companies} company/companies, ${plans ?? 0} annual plan(s)`);
  if ((plans ?? 0) === 0) fail("companies exist but no annual_plans — generation returns 'No annual plan found'");
}

// 5. Billing gate. Generation is checked against ai_uses_month BEFORE Claude is
//    called, so a zero limit on the trial's plan blocks every generation.
console.log("\nBilling gate");
const { data: settings } = await db
  .from("app_settings").select("stripe_enabled, trial_enabled, trial_days").eq("id", "global").maybeSingle();

if (!settings?.stripe_enabled) {
  pass("billing disabled — entitlement checks no-op, generation is open");
} else {
  pass("billing enabled — generation requires an allowance");
  const { data: limits } = await db
    .from("plan_limits")
    .select("plan_id, limit_value, subscription_plans(name)")
    .eq("limit_key", "ai_uses_month");

  for (const l of limits ?? []) {
    const name = l.subscription_plans?.name ?? l.plan_id;
    if (l.limit_value === 0) fail(`plan "${name}" allows 0 AI uses/month — generation always blocked`);
    else pass(`plan "${name}": ${l.limit_value === -1 ? "unlimited" : l.limit_value} AI uses/month`);
  }
}

console.log(
  failures === 0
    ? "\nReady: nothing blocking generation.\n"
    : `\n${failures} blocking problem(s) found.\n`
);
process.exit(failures === 0 ? 0 : 1);
