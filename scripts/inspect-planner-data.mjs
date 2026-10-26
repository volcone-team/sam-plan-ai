/**
 * What the Monthly / Quarterly / Weekly planners can show for one company.
 *
 * Those screens read `projections`, `monthly_plans`, `quarterly_plans` and
 * `weekly_plans` rather than summing initiatives. This lists what each table
 * holds next to the initiatives' own Good/Better/Best, so an empty screen can
 * be traced to missing rows rather than guessed at.
 *
 * Read-only. Usage: node scripts/inspect-planner-data.mjs <company-uuid>
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
const companyId = process.argv[2];
if (!companyId) {
  console.error("Usage: node scripts/inspect-planner-data.mjs <company-uuid>");
  process.exit(1);
}

const { data: plans } = await db
  .from("annual_plans")
  .select("id, year, baseline_revenue, stretch_revenue")
  .eq("company_id", companyId)
  .order("year");
console.log("annual_plans:", plans);

for (const table of ["projections", "quarterly_plans", "monthly_plans", "weekly_plans"]) {
  // projections carries company_id. The period plans chain off each other
  // (annual -> quarterly -> monthly), so for those this reports rows across
  // ALL companies: zero there means no code path has ever written them.
  const query = db.from(table).select("*");
  const { data, error } =
    table === "projections"
      ? await query.eq("company_id", companyId)
      : table === "quarterly_plans"
        ? await query.in("annual_plan_id", (plans ?? []).map((p) => p.id))
        : await query.limit(50);
  if (table !== "projections" && table !== "quarterly_plans") console.log(`(${table}: all companies)`);
  if (error) {
    console.log(`${table}: error ${error.message}`);
    continue;
  }
  console.log(`${table}: ${data.length} row(s)`);
  for (const r of data.slice(0, 6)) {
    const brief = { ...r };
    if (Array.isArray(brief.monthly)) brief.monthly = `${brief.monthly.length} entries, first: ${JSON.stringify(brief.monthly[0])}`;
    console.log("  ", JSON.stringify(brief).slice(0, 400));
  }
}

const { data: inits } = await db
  .from("initiatives")
  .select("name, annual_plan_id, activation_date, event_date, revenue_good, revenue_better, revenue_best, status")
  .eq("company_id", companyId)
  .order("activation_date");
console.log(`initiatives: ${inits?.length ?? 0}`);
for (const i of inits ?? []) {
  const year = plans?.find((p) => p.id === i.annual_plan_id)?.year;
  console.log(
    `   ${i.name.padEnd(40)} plan=${year ?? "-"} act=${i.activation_date ?? "-"} evt=${i.event_date ?? "-"} G/B/B=${i.revenue_good}/${i.revenue_better}/${i.revenue_best}`
  );
}
