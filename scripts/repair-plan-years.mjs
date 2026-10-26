/**
 * Repair annual_plans rows and initiative filing for intake-built plans.
 *
 * Two bugs left data behind:
 *   1. Intake build created/targeted annual_plans only for years that held a
 *      scheduled event, so a plan starting Nov 2026 had no 2026 row and 2026
 *      read "No target set".
 *   2. Add Initiative filed every new initiative under the page's selected
 *      plan, so an Oct 2026 initiative added while 2028 was selected belongs
 *      to the 2028 plan.
 *
 * For every company with a v2 planning_inputs row (latest one), this computes
 * the calendar years the horizon covers (plan_start_month .. + horizon_months
 * - 1) and reports:
 *   - horizon years with no annual_plans row
 *   - horizon years whose baseline_revenue is 0
 *   - initiatives whose plan's year differs from their launch year
 *     (activation date's year, else event date's)
 *
 * DRY RUN BY DEFAULT: reads only. With --apply it:
 *   - creates missing horizon-year rows (status 'active', prorated targets)
 *   - sets prorated targets ONLY where baseline_revenue is 0 (stretch only if
 *     it is 0 too) — a non-zero target is never overwritten
 *   - re-points mismatched initiatives to their launch-year plan, creating
 *     that row ('draft', zero targets) when it is outside the horizon
 *
 *   node scripts/repair-plan-years.mjs                     # dry run, all companies
 *   node scripts/repair-plan-years.mjs --company=<uuid>    # dry run, one company
 *   node scripts/repair-plan-years.mjs --apply             # WRITES
 *
 * The proration mirrors src/lib/intake/plan-years.ts and planTargets in
 * src/lib/intake/build-forecast.ts (stretch = goal × 1.3). Kept as a copy
 * because this runs as plain Node; plan-years.test.ts pins the behaviour.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");
const companyArg = process.argv.find((a) => a.startsWith("--company="))?.slice("--company=".length) ?? null;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* ---- Pure helpers (copy of src/lib/intake/plan-years.ts) ---- */

const PLANNING_PERIODS = [3, 6, 12, 18];
const DEFAULT_PLANNING_PERIOD = 12;
const BEST_MULTIPLIER = 1.3;

function horizonYears(startMonth, months) {
  const match = /^(\d{4})-(\d{2})/.exec(String(startMonth ?? ""));
  const span = Math.floor(Number(months));
  if (!match || !Number.isFinite(span) || span < 1) return [];
  const startIndex = Number(match[2]) - 1;
  if (startIndex < 0 || startIndex > 11) return [];
  const out = [];
  let remaining = span;
  let year = Number(match[1]);
  let monthIndex = startIndex;
  while (remaining > 0) {
    const inYear = Math.min(12 - monthIndex, remaining);
    out.push({ year, months: inYear });
    remaining -= inYear;
    year += 1;
    monthIndex = 0;
  }
  return out;
}

function prorate(total, years) {
  const out = new Map();
  if (years.length === 0) return out;
  const whole = Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
  const totalMonths = years.reduce((s, y) => s + y.months, 0);
  let allocated = 0;
  years.forEach((y, i) => {
    if (i === years.length - 1) return out.set(y.year, whole - allocated);
    const share = totalMonths > 0 ? Math.round((whole * y.months) / totalMonths) : 0;
    out.set(y.year, share);
    allocated += share;
  });
  return out;
}

function planTargets(goal) {
  const g = Number(goal);
  if (!Number.isFinite(g) || g <= 0) return { baseline: 0, stretch: 0 };
  return { baseline: Math.round(g), stretch: Math.round(g * BEST_MULTIPLIER) };
}

function yearOf(value) {
  const m = /^(\d{4})-\d{2}/.exec(String(value ?? ""));
  return m ? Number(m[1]) : null;
}

function launchYear(activation, event) {
  return yearOf(activation) ?? yearOf(event);
}

/* ---- Reads ---- */

async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

const inputs = await fetchAll(() => {
  let q = db
    .from("planning_inputs")
    .select("id, company_id, plan_start_month, horizon_months, revenue_goal, created_at")
    .eq("intake_version", 2)
    .order("created_at", { ascending: false });
  if (companyArg) q = q.eq("company_id", companyArg);
  return q;
});

// Latest v2 row per company, which is the one intake build reads.
const latestByCompany = new Map();
for (const row of inputs) if (!latestByCompany.has(row.company_id)) latestByCompany.set(row.company_id, row);

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${latestByCompany.size} company(ies) with a v2 planning_inputs row\n`);

const fmt = (n) => `$${Number(n || 0).toLocaleString("en-US")}`;
const totals = { missingRows: 0, zeroTargets: 0, mismatched: 0, companiesWithIssues: 0, writes: 0, failures: 0 };

for (const [companyId, input] of latestByCompany) {
  const horizon = PLANNING_PERIODS.includes(Number(input.horizon_months))
    ? Number(input.horizon_months)
    : DEFAULT_PLANNING_PERIOD;
  const years = horizonYears(input.plan_start_month, horizon);
  const targets = planTargets(input.revenue_goal);
  const baseline = prorate(targets.baseline, years);
  const stretch = prorate(targets.stretch, years);

  const [{ data: company }, { data: plansData, error: planErr }] = await Promise.all([
    db.from("companies").select("name").eq("id", companyId).maybeSingle(),
    db.from("annual_plans").select("id, year, baseline_revenue, stretch_revenue, status").eq("company_id", companyId),
  ]);
  if (planErr) {
    console.log(`! ${companyId}: could not read annual_plans: ${planErr.message}`);
    totals.failures += 1;
    continue;
  }
  const initiatives = await fetchAll(() =>
    db
      .from("initiatives")
      .select("id, name, annual_plan_id, activation_date, event_date")
      .eq("company_id", companyId)
      .order("id")
  );

  const plans = plansData ?? [];
  const planByYear = new Map(plans.map((p) => [p.year, p]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  const missing = years.filter((y) => !planByYear.has(y.year));
  const zero = years.filter((y) => {
    const p = planByYear.get(y.year);
    return p && Number(p.baseline_revenue) === 0;
  });
  const mismatched = initiatives
    .map((i) => {
      const want = launchYear(i.activation_date, i.event_date);
      const have = planById.get(i.annual_plan_id)?.year ?? null;
      return { ...i, want, have };
    })
    .filter((i) => i.want !== null && i.want !== i.have);

  if (missing.length === 0 && zero.length === 0 && mismatched.length === 0) continue;
  totals.companiesWithIssues += 1;
  totals.missingRows += missing.length;
  totals.zeroTargets += zero.length;
  totals.mismatched += mismatched.length;

  console.log(`■ ${company?.name ?? "(no name)"} — ${companyId}`);
  console.log(
    `  horizon: ${String(input.plan_start_month).slice(0, 7)} + ${horizon} months -> ` +
      years.map((y) => `${y.year} (${y.months} mo)`).join(", ") +
      `; goal ${fmt(input.revenue_goal)} (stretch ${fmt(targets.stretch)})`
  );
  console.log(
    "  plans:   " +
      (plans.length
        ? [...plans]
            .sort((a, b) => a.year - b.year)
            .map((p) => `${p.year} ${p.status} ${fmt(p.baseline_revenue)}/${fmt(p.stretch_revenue)}`)
            .join("; ")
        : "(none)")
  );
  for (const y of missing) {
    console.log(`  MISSING ROW ${y.year}: would create active, ${fmt(baseline.get(y.year))} / ${fmt(stretch.get(y.year))}`);
  }
  for (const y of zero) {
    const p = planByYear.get(y.year);
    const s = Number(p.stretch_revenue) === 0 ? fmt(stretch.get(y.year)) : `${fmt(p.stretch_revenue)} (kept)`;
    console.log(
      targets.baseline > 0
        ? `  ZERO TARGET ${y.year}: would set ${fmt(baseline.get(y.year))} / ${s}`
        : `  ZERO TARGET ${y.year}: no revenue goal on the intake, nothing to set`
    );
  }
  for (const i of mismatched) {
    const dest = planByYear.get(i.want);
    console.log(
      `  MISFILED "${i.name}" (${i.id}) act ${i.activation_date ?? "—"} evt ${i.event_date ?? "—"}: ` +
        `plan ${i.have ?? "?"} -> ${i.want}${dest ? "" : " (row to be created)"}`
    );
  }

  if (!APPLY) {
    console.log("");
    continue;
  }

  /* ---- Writes (only with --apply) ---- */

  const ensurePlan = async (year, init) => {
    const known = planByYear.get(year);
    if (known) return known;
    const { data, error } = await db
      .from("annual_plans")
      .insert({ company_id: companyId, year, ...init })
      .select("id, year, baseline_revenue, stretch_revenue, status")
      .single();
    if (error) {
      // Unique (company_id, year): someone created it meanwhile.
      const { data: raced } = await db
        .from("annual_plans")
        .select("id, year, baseline_revenue, stretch_revenue, status")
        .eq("company_id", companyId)
        .eq("year", year)
        .maybeSingle();
      if (raced) return raced;
      console.log(`  ! create ${year} failed: ${error.message}`);
      totals.failures += 1;
      return null;
    }
    console.log(`  + created ${year} plan ${data.id}`);
    totals.writes += 1;
    planByYear.set(year, data);
    planById.set(data.id, data);
    return data;
  };

  for (const y of missing) {
    await ensurePlan(y.year, {
      status: "active",
      baseline_revenue: baseline.get(y.year) ?? 0,
      stretch_revenue: stretch.get(y.year) ?? 0,
    });
  }

  if (targets.baseline > 0) {
    for (const y of zero) {
      const p = planByYear.get(y.year);
      const patch = { baseline_revenue: baseline.get(y.year) ?? 0, status: "active" };
      if (Number(p.stretch_revenue) === 0) patch.stretch_revenue = stretch.get(y.year) ?? 0;
      // Guarded on baseline still being 0, so a target set since the read survives.
      const { data, error } = await db
        .from("annual_plans")
        .update(patch)
        .eq("id", p.id)
        .eq("company_id", companyId)
        .eq("baseline_revenue", 0)
        .select("id");
      if (error) {
        console.log(`  ! set targets ${y.year} failed: ${error.message}`);
        totals.failures += 1;
      } else if ((data ?? []).length > 0) {
        console.log(`  ~ set ${y.year} targets ${fmt(patch.baseline_revenue)} / ${patch.stretch_revenue !== undefined ? fmt(patch.stretch_revenue) : "(stretch kept)"}`);
        totals.writes += 1;
      }
    }
  }

  const horizonSet = new Set(years.map((y) => y.year));
  for (const i of mismatched) {
    const dest = await ensurePlan(
      i.want,
      horizonSet.has(i.want)
        ? { status: "active", baseline_revenue: baseline.get(i.want) ?? 0, stretch_revenue: stretch.get(i.want) ?? 0 }
        : { status: "draft", baseline_revenue: 0, stretch_revenue: 0 }
    );
    if (!dest) continue;
    const { error } = await db
      .from("initiatives")
      .update({ annual_plan_id: dest.id })
      .eq("id", i.id)
      .eq("company_id", companyId);
    if (error) {
      console.log(`  ! re-point "${i.name}" failed: ${error.message}`);
      totals.failures += 1;
    } else {
      console.log(`  ~ moved "${i.name}" to the ${i.want} plan`);
      totals.writes += 1;
    }
  }
  console.log("");
}

console.log(
  `Summary: ${totals.companiesWithIssues} company(ies) with issues; ` +
    `${totals.missingRows} missing row(s), ${totals.zeroTargets} zero-target year(s), ` +
    `${totals.mismatched} misfiled initiative row(s).` +
    (APPLY ? ` Writes: ${totals.writes}, failures: ${totals.failures}.` : " Nothing written (dry run; pass --apply to write).")
);
