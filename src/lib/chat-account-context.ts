import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The caller's OWN account data, rendered for the chat prompt.
 *
 * WHY THIS EXISTS. The assistant was grounded in the workbook alone and its
 * prompt stated outright that it could not see the user's plan or numbers. So
 * "what should I do next for my business?" — the most natural question anyone
 * asks a chatbot inside a planning tool — could only ever get a generic answer
 * about the catalogue.
 *
 * DIVISION OF RESPONSIBILITY, which the prompt enforces:
 *   - the WORKBOOK remains the only source of advice, benchmarks and tactics;
 *   - ACCOUNT DATA is the situation that advice is applied to.
 * The model must not invent initiatives from account data, and must not quote
 * figures that are not here.
 *
 * SECURITY. `companyId` is always derived server-side from the authenticated
 * session, never from the request body. Every query below filters on it, so a
 * conversation can only ever surface the caller's own company — guessing or
 * forging an id in the payload cannot reach another account's revenue.
 *
 * SIZE. Deliberately bounded: a summary plus the most relevant rows, not a
 * dump. The whole thing is re-sent as system context on every turn, so an
 * unbounded version would make each message progressively more expensive.
 */

/** Row caps. Enough for context, small enough to re-send every turn. */
const MAX_INITIATIVES = 25;
const MAX_PRODUCTS = 15;
const MAX_RESULT_WEEKS = 12;

export interface AccountSnapshot {
  companyName: string | null;
  currency: string;
  planningYear: number | null;
  priorYearRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  products: {
    name: string; price: number; revenueType: string; tier: string;
  }[];
  initiatives: {
    name: string; status: string; kind: string; activationDate: string | null;
    eventDate: string | null; revenueBetter: number; plannedBudget: number;
    actualSpend: number;
  }[];
  results: {
    weekStart: string; revenue: number; spend: number;
  }[];
  totals: { actualRevenue: number; actualSpend: number; resultWeeks: number };
  intake: {
    revenueGoal: number; timeframeMonths: number; idealCustomer: string;
    whatWorked: string[]; whatFailed: string; monthlyMarketingBudget: number;
    teamSize: number;
  } | null;
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Load a bounded snapshot of one company's data.
 *
 * Returns null when there is no company — a brand-new account mid-onboarding.
 * The caller then falls back to workbook-only grounding rather than claiming to
 * know things about a business it has no data for.
 */
export async function loadAccountSnapshot(
  db: SupabaseClient,
  companyId: string
): Promise<AccountSnapshot | null> {
  const { data: companyRaw } = await db
    .from("companies")
    .select(
      "name, currency, planning_year, prior_year_revenue, baseline_revenue, " +
      "stretch_revenue, operating_budget"
    )
    .eq("id", companyId)
    .maybeSingle();

  /**
   * Cast via `unknown`: supabase-js cannot infer a row shape from a
   * CONCATENATED select string and falls back to a union that includes an error
   * type, so every property access is reported as missing. Same pattern as
   * api/admin/subscribers.
   */
  const company = companyRaw as unknown as {
    name: string | null; currency: string | null; planning_year: number | null;
    prior_year_revenue: unknown; baseline_revenue: unknown;
    stretch_revenue: unknown; operating_budget: unknown;
  } | null;

  if (!company) return null;

  const planningYear = company.planning_year ?? null;

  // The plan for the year being worked on, which carries the live targets —
  // companies.* holds the onboarding figures and can lag behind.
  const { data: plan } = planningYear
    ? await db
        .from("annual_plans")
        .select("baseline_revenue, stretch_revenue, operating_budget")
        .eq("company_id", companyId)
        .eq("year", planningYear)
        .maybeSingle()
    : { data: null };

  const [
    { data: products },
    { data: initiatives },
    { data: results },
    { data: intakeRaw },
  ] = await Promise.all([
    db
      .from("products")
      .select("name, price, revenue_type, ticket_tier")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("display_order")
      .limit(MAX_PRODUCTS),
    db
      .from("initiatives")
      .select(
        "name, status, kind, activation_date, event_date, revenue_better, " +
        "planned_budget, actual_spend"
      )
      .eq("company_id", companyId)
      .order("activation_date", { ascending: true })
      .limit(MAX_INITIATIVES),
    db
      .from("results")
      .select("week_start_date, actual_revenue, actual_spend")
      .eq("company_id", companyId)
      .order("week_start_date", { ascending: false })
      .limit(MAX_RESULT_WEEKS),
    db
      .from("planning_inputs")
      .select(
        "revenue_goal, revenue_timeframe, ideal_customer_description, " +
        "successful_initiative_types, failed_initiatives, " +
        "monthly_marketing_budget, team_size"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const resultRows = (results ?? []) as unknown as {
    week_start_date: string; actual_revenue: unknown; actual_spend: unknown;
  }[];

  // Same concatenated-select caveat as `company` above.
  const intake = intakeRaw as unknown as {
    revenue_goal: unknown; revenue_timeframe: unknown;
    ideal_customer_description: string | null;
    successful_initiative_types: string[] | null;
    failed_initiatives: string | null;
    monthly_marketing_budget: unknown; team_size: unknown;
  } | null;

  return {
    companyName: company.name ?? null,
    currency: company.currency ?? "USD",
    planningYear,
    priorYearRevenue: num(company.prior_year_revenue),
    // Plan values win over the company row; see above.
    baselineRevenue: num(plan?.baseline_revenue ?? company.baseline_revenue),
    stretchRevenue: num(plan?.stretch_revenue ?? company.stretch_revenue),
    operatingBudget: num(plan?.operating_budget ?? company.operating_budget),
    products: ((products ?? []) as unknown as Record<string, unknown>[]).map((p) => ({
      name: (p.name as string) ?? "",
      price: num(p.price),
      revenueType: (p.revenue_type as string) ?? "one-time",
      tier: (p.ticket_tier as string) ?? "mid",
    })),
    initiatives: ((initiatives ?? []) as unknown as Record<string, unknown>[]).map((i) => ({
      name: (i.name as string) ?? "",
      status: (i.status as string) ?? "planned",
      kind: (i.kind as string) ?? "one-time",
      activationDate: (i.activation_date as string) ?? null,
      eventDate: (i.event_date as string) ?? null,
      revenueBetter: num(i.revenue_better),
      plannedBudget: num(i.planned_budget),
      actualSpend: num(i.actual_spend),
    })),
    results: resultRows.map((r) => ({
      weekStart: r.week_start_date,
      revenue: num(r.actual_revenue),
      spend: num(r.actual_spend),
    })),
    totals: {
      actualRevenue: resultRows.reduce((s, r) => s + num(r.actual_revenue), 0),
      actualSpend: resultRows.reduce((s, r) => s + num(r.actual_spend), 0),
      resultWeeks: resultRows.length,
    },
    intake: intake
      ? {
          revenueGoal: num(intake.revenue_goal),
          timeframeMonths: num(intake.revenue_timeframe) || 12,
          idealCustomer: (intake.ideal_customer_description as string) ?? "",
          whatWorked: (intake.successful_initiative_types as string[]) ?? [],
          whatFailed: (intake.failed_initiatives as string) ?? "",
          monthlyMarketingBudget: num(intake.monthly_marketing_budget),
          teamSize: num(intake.team_size) || 1,
        }
      : null,
  };
}

function money(value: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Render the snapshot as prose for the prompt.
 *
 * Plain labelled lines rather than JSON: it costs fewer tokens and the model
 * reads it more reliably. Empty sections are OMITTED rather than written as
 * "none", so the model is not nudged into discussing data that is simply absent
 * on a new account.
 */
export function renderAccountSnapshot(snap: AccountSnapshot): string {
  const cur = snap.currency;
  const lines: string[] = [];

  lines.push(`Business: ${snap.companyName ?? "(unnamed)"}`);
  if (snap.planningYear) lines.push(`Planning year: ${snap.planningYear}`);

  if (snap.baselineRevenue > 0 || snap.stretchRevenue > 0) {
    lines.push(
      `Revenue targets: baseline ${money(snap.baselineRevenue, cur)}, ` +
      `stretch ${money(snap.stretchRevenue, cur)}`
    );
  }
  if (snap.priorYearRevenue > 0) {
    lines.push(`Prior year revenue: ${money(snap.priorYearRevenue, cur)}`);
  }
  if (snap.operatingBudget > 0) {
    lines.push(`Operating budget: ${money(snap.operatingBudget, cur)}`);
  }

  if (snap.intake) {
    const i = snap.intake;
    if (i.idealCustomer) lines.push(`Ideal customer: ${i.idealCustomer}`);
    if (i.whatWorked.length > 0) {
      lines.push(`Has worked before: ${i.whatWorked.join(", ")}`);
    }
    if (i.whatFailed) lines.push(`Has not worked: ${i.whatFailed}`);
    if (i.monthlyMarketingBudget > 0) {
      lines.push(`Monthly marketing budget: ${money(i.monthlyMarketingBudget, cur)}`);
    }
    lines.push(`Team size: ${i.teamSize}`);
  }

  if (snap.products.length > 0) {
    lines.push("", "Products:");
    for (const p of snap.products) {
      lines.push(`- ${p.name} — ${money(p.price, cur)} (${p.revenueType}, ${p.tier} ticket)`);
    }
  }

  if (snap.initiatives.length > 0) {
    lines.push("", `Initiatives in their plan (${snap.initiatives.length}):`);
    for (const i of snap.initiatives) {
      const when = i.eventDate ?? i.activationDate ?? "undated";
      lines.push(
        `- ${i.name} [${i.status}, ${i.kind}] ${when} · ` +
        `projected ${money(i.revenueBetter, cur)} · ` +
        `budget ${money(i.plannedBudget, cur)}, spent ${money(i.actualSpend, cur)}`
      );
    }
  }

  if (snap.totals.resultWeeks > 0) {
    lines.push(
      "",
      `Recorded results (last ${snap.totals.resultWeeks} week(s)): ` +
      `revenue ${money(snap.totals.actualRevenue, cur)}, ` +
      `spend ${money(snap.totals.actualSpend, cur)}`
    );
  } else {
    // Stated explicitly: without it the model tends to assume results exist and
    // talk about performance the user has never entered.
    lines.push("", "Recorded results: none yet — they have not logged actuals.");
  }

  return lines.join("\n");
}

/** True when there is enough here to reason about. */
export function hasUsableAccountData(snap: AccountSnapshot | null): boolean {
  if (!snap) return false;
  return (
    snap.products.length > 0 ||
    snap.initiatives.length > 0 ||
    snap.baselineRevenue > 0 ||
    snap.stretchRevenue > 0 ||
    snap.intake !== null
  );
}
