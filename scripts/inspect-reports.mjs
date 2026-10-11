/**
 * What the Reports page can actually show for a company.
 *
 * Reports read `projections`, `results` and `expenses` — NOT initiative
 * forecasts. So a plan can look complete on the dashboard and still report
 * zeros, which is the question this answers: is it empty because of a bug, or
 * because those three tables have nothing in them yet?
 *
 * Read-only. Usage: node scripts/inspect-reports.mjs [email]
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

const emailArg = process.argv[2];

const { data: companies } = await db
  .from("companies")
  .select("id, name")
  .order("created_at", { ascending: false });

for (const company of companies ?? []) {
  if (emailArg) {
    const { data: profiles } = await db
      .from("profiles")
      .select("email")
      .eq("company_id", company.id);
    const match = (profiles ?? []).some((p) =>
      String(p.email ?? "").toLowerCase().includes(emailArg.toLowerCase())
    );
    if (!match) continue;
  }

  const [
    { data: plans },
    { data: initiatives },
    { count: projectionCount },
    { count: resultCount },
    { count: expenseCount },
    { count: productCount },
  ] = await Promise.all([
    db.from("annual_plans").select("id, year, baseline_revenue, stretch_revenue").eq("company_id", company.id).order("year"),
    db.from("initiatives").select("id, name, activation_date, event_date, revenue_good, revenue_better, revenue_best, planned_budget").eq("company_id", company.id),
    db.from("projections").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    db.from("results").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    db.from("expenses").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    db.from("products").select("id", { count: "exact", head: true }).eq("company_id", company.id),
  ]);

  console.log(`\n${"=".repeat(62)}`);
  console.log(`${company.name}  (${company.id})`);
  console.log("=".repeat(62));

  console.log("\nAnnual plans");
  for (const p of plans ?? []) {
    console.log(
      `  ${p.year}  baseline ${Number(p.baseline_revenue).toLocaleString()}` +
        `  stretch ${Number(p.stretch_revenue).toLocaleString()}`
    );
  }
  if (!plans?.length) console.log("  (none)");

  console.log(`\nProducts: ${productCount ?? 0}`);

  console.log(`\nInitiatives: ${initiatives?.length ?? 0}`);
  let forecastTotal = 0;
  for (const i of initiatives ?? []) {
    forecastTotal += Number(i.revenue_better) || 0;
    console.log(
      `  ${i.event_date ?? i.activation_date}  ${String(i.name).slice(0, 34).padEnd(34)}` +
        ` better ${String(Number(i.revenue_better) || 0).padStart(9)}` +
        ` budget ${String(Number(i.planned_budget) || 0).padStart(7)}`
    );
  }
  console.log(`  ---- forecast total (better): ${forecastTotal.toLocaleString()}`);

  console.log("\nWhat the REPORTS page reads:");
  console.log(`  projections : ${projectionCount ?? 0}   <- Revenue report (projected column)`);
  console.log(`  results     : ${resultCount ?? 0}   <- every "actual" figure, ROI report`);
  console.log(`  expenses    : ${expenseCount ?? 0}   <- Expenses report`);

  const notes = [];
  if ((projectionCount ?? 0) === 0)
    notes.push("Revenue report shows projected 0 — no projections rows exist.");
  if ((resultCount ?? 0) === 0)
    notes.push("Every actual/ROI figure is 0 — no results logged yet (expected until weekly numbers are entered).");
  if ((expenseCount ?? 0) === 0)
    notes.push("Expenses report is 0 — no expenses logged yet.");
  if (forecastTotal > 0 && (projectionCount ?? 0) === 0)
    notes.push(
      `Initiatives carry ${forecastTotal.toLocaleString()} of forecast, but projections is empty — ` +
        "so the dashboard shows revenue while the Revenue report shows 0."
    );

  if (notes.length) {
    console.log("\nWhy it reads zero:");
    for (const n of notes) console.log(`  - ${n}`);
  }
}

console.log("");
