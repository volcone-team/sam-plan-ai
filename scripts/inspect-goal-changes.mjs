/**
 * Which companies had their revenue goals changed by Enhance Plan?
 *
 * Before the fix, accepting a `target_change` suggestion wrote the proposed
 * baseline/stretch goals to `companies` and to the NEWEST `annual_plans` row.
 * This lists every accepted `target_change` suggestion next to the company's
 * goals today and every annual plan row, and flags where today's goals still
 * equal the proposed values (i.e. the change is probably still in effect).
 *
 * Read-only: SELECT queries only. It changes nothing. Restoring goals is a
 * separate, owner-approved step and is deliberately not part of this script.
 *
 * Usage: node scripts/inspect-goal-changes.mjs
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

const num = (v) => (v == null || v === "" ? null : Number(v));
const fmt = (v) => (v == null ? "-" : Number(v).toLocaleString("en-US"));

/** Read baseline/stretch from a suggestion's JSON (camelCase or snake_case). */
function goalsOf(json) {
  if (!json || typeof json !== "object") return { baseline: null, stretch: null };
  return {
    baseline: num(json.baselineRevenue ?? json.baseline_revenue),
    stretch: num(json.stretchRevenue ?? json.stretch_revenue),
  };
}

/** True when every goal the suggestion proposed equals the given goals. */
function matchesProposed(proposed, goals) {
  const keys = ["baseline", "stretch"].filter((k) => proposed[k] != null);
  if (keys.length === 0) return false;
  return keys.every((k) => num(goals[k]) === proposed[k]);
}

const { data: suggestions, error: sErr } = await db
  .from("plan_suggestions")
  .select("id, company_id, title, decided_at, current_value, proposed_value")
  .eq("suggestion_type", "target_change")
  .eq("status", "accepted")
  .order("decided_at", { ascending: true });
if (sErr) {
  console.error("plan_suggestions query failed:", sErr.message);
  process.exit(1);
}

console.log(`Accepted target_change suggestions: ${suggestions?.length ?? 0}`);
if (!suggestions?.length) process.exit(0);

const companyIds = [...new Set(suggestions.map((s) => s.company_id))];
const [{ data: companies, error: cErr }, { data: plans, error: pErr }] = await Promise.all([
  db.from("companies").select("id, name, baseline_revenue, stretch_revenue").in("id", companyIds),
  db
    .from("annual_plans")
    .select("id, company_id, year, baseline_revenue, stretch_revenue")
    .in("company_id", companyIds)
    .order("year", { ascending: true }),
]);
if (cErr || pErr) {
  console.error("Query failed:", (cErr ?? pErr).message);
  process.exit(1);
}

let flaggedCompanies = 0;
for (const companyId of companyIds) {
  const company = companies?.find((c) => c.id === companyId);
  const companyGoals = {
    baseline: company?.baseline_revenue,
    stretch: company?.stretch_revenue,
  };
  const companyPlans = (plans ?? []).filter((p) => p.company_id === companyId);
  const rows = suggestions.filter((s) => s.company_id === companyId);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${company?.name ?? "(company not found)"}  ${companyId}`);
  console.log(
    `Today on companies: baseline ${fmt(companyGoals.baseline)}, stretch ${fmt(companyGoals.stretch)}`
  );
  console.log("Annual plans:");
  if (companyPlans.length === 0) console.log("  (none)");
  for (const p of companyPlans) {
    console.log(
      `  ${p.year}: baseline ${fmt(p.baseline_revenue)}, stretch ${fmt(p.stretch_revenue)}`
    );
  }

  let flagged = false;
  console.table(
    rows.map((s) => {
      const cur = goalsOf(s.current_value);
      const prop = goalsOf(s.proposed_value);
      const onCompany = matchesProposed(prop, companyGoals);
      const onPlans = companyPlans
        .filter((p) =>
          matchesProposed(prop, { baseline: p.baseline_revenue, stretch: p.stretch_revenue })
        )
        .map((p) => p.year);
      if (onCompany || onPlans.length) flagged = true;
      return {
        decided_at: s.decided_at ?? "-",
        current_baseline: fmt(cur.baseline),
        current_stretch: fmt(cur.stretch),
        proposed_baseline: fmt(prop.baseline),
        proposed_stretch: fmt(prop.stretch),
        company_eq_proposed: onCompany ? "YES" : "no",
        plan_years_eq_proposed: onPlans.length ? onPlans.join(",") : "-",
      };
    })
  );
  if (flagged) flaggedCompanies++;
}

console.log(
  `\nCompanies: ${companyIds.length}. Goals today still equal a proposed value: ${flaggedCompanies}.`
);
console.log("Nothing was changed. Restoring goals needs the owner's approval.");
