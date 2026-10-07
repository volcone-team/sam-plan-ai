import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { loadLibrary, loadAiContext, renderLibraryForPrompt } from "@/lib/workbook/read";
import { classifyAiFailure, aiFailureLogDetail } from "@/lib/ai-errors";
import { EXCLUDED_PICKER_CATEGORIES } from "@/lib/intake/schema";
import { filterEligible, isEligible, type EligibilityContext } from "@/lib/recommend/eligibility";
import { recommendationCount } from "@/lib/recommend/sizing";
import type { LibraryInitiative } from "@/lib/intake/library";
import {
  forecastForInitiative,
  goalGap,
  productGoal,
  type InitiativeCadence,
  type RepeatFrequency,
} from "@/lib/intake-forecast";
import { LIMIT_KEYS } from "@/lib/billing/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

/**
 * POST /api/intake/recommend — forecast the user's plan and recommend the rest.
 *
 * THE SHAPE THAT MATTERS: the AI PROPOSES a ranked list and this route DISPOSES.
 * Every candidate is passed through `isEligible` server-side before it reaches
 * the screen, and anything the model invented that is not a real library key is
 * dropped. Prompt instructions are not enforcement — the model can ignore them,
 * and a sales-call initiative recommended to someone who takes no sales calls
 * discredits the whole plan rather than one card.
 *
 * The route also DEGRADES rather than failing. If the AI is unavailable — and
 * it currently is, the account being out of credit — the eligible library is
 * ranked by our own heuristic instead. A user part-way through an intake should
 * not hit a dead end because of a billing condition on our side.
 *
 * Responses:
 *   200 { gap, yours[], recommended[], planLimit, aiUnavailable }
 *   401 { error: "Unauthorized" }
 *   409 { error } — no company, or no saved intake
 */

interface Recommendation {
  key: string;
  name: string;
  oneLiner: string | null;
  category: string | null;
  difficulty: number | null;
  speedToResults: string | null;
  /** Expected revenue over the plan period. */
  forecast: number;
  /**
   * True when the figure came from benchmarks rather than the user's own
   * numbers, which the card must say (REQ-13.6).
   */
  fromBenchmarks: boolean;
  /** One line on why it fits, from the model where available. */
  why: string | null;
  /** Product ids this initiative is suggested to sell. */
  productIds: string[];
}

export async function POST() {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { db, companyId } = caller;

    const { data: input } = await db
      .from("planning_inputs")
      .select("*")
      .eq("company_id", companyId)
      .eq("intake_version", 2)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!input) {
      return NextResponse.json(
        { error: "No intake answers saved yet." },
        { status: 409 }
      );
    }

    const planningInputId = input.id as string;

    const [{ data: productRows }, { data: initiativeRows }] = await Promise.all([
      db
        .from("intake_products")
        .select("*")
        .eq("planning_input_id", planningInputId)
        .order("display_order"),
      db
        .from("intake_initiatives")
        .select("*")
        .eq("planning_input_id", planningInputId)
        .order("display_order"),
    ]);

    const products = (productRows ?? []) as Record<string, unknown>[];
    const initiatives = (initiativeRows ?? []) as Record<string, unknown>[];

    const horizonMonths = num(input.horizon_months) ?? 12;
    const revenueGoal = num(input.revenue_goal) ?? 0;

    /* ---- The user's own initiatives, forecast ---- */

    const planned = initiatives.filter((row) => (row.source ?? "planned") === "planned");

    const yours = planned.map((row) => ({
      key: str(row.initiative_key) ?? "",
      name: str(row.initiative_label) ?? str(row.custom_label) ?? "Initiative",
      forecast:
        forecastForInitiative({
          funnel: {
            audienceReached: num(row.audience_reached),
            stages: Array.isArray(row.funnel_stages)
              ? (row.funnel_stages as { key: string; label: string; percent: number | null }[])
              : [],
            averagePrice: num(row.average_price),
          },
          cadence: (str(row.cadence) ?? "once") as InitiativeCadence,
          frequency: str(row.repeat_frequency) as RepeatFrequency | null,
          horizonMonths,
        }) ?? null,
      productIds: toStringArray(row.product_ids),
    }));

    /* ---- Eligibility context from the answers ---- */

    const didntWork = initiatives
      .filter((row) => row.source === "failed")
      .map((row) => str(row.initiative_key))
      .filter((key): key is string => key !== null);

    const ctx: EligibilityContext = {
      industry: str(input.industry),
      didntWork,
      monthlyBudget: num(input.monthly_marketing_budget),
      hoursPerWeek: num(input.weekly_hours),
      whoCloses: str(input.sales_owner),
      stage: str(input.growth_stage),
    };

    /* ---- The candidate pool ---- */

    const excluded = new Set(EXCLUDED_PICKER_CATEGORIES.map((c) => c.toLowerCase()));
    const alreadyPlanned = new Set(yours.map((y) => y.key));

    const library: LibraryInitiative[] = (await loadLibrary(db))
      .filter((entry) => !excluded.has((entry.category ?? "").toLowerCase()))
      .map((entry) => ({
        key: entry.initiativeKey,
        name: entry.name,
        category: entry.category,
        oneLiner: entry.oneLiner,
        ownOrOps: entry.ownOrOps,
        priceTier: entry.priceTier,
        difficulty: entry.difficulty,
        speedToResults: entry.speedToResults,
        needsSalesTeam: entry.needsSalesTeam,
      }));

    // Never re-recommend something the user already planned themselves.
    const pool = filterEligible(library, ctx).filter(
      (entry) => !alreadyPlanned.has(entry.key)
    );

    /* ---- How many to add ---- */

    const yoursTotal = yours.reduce((sum, y) => sum + (y.forecast ?? 0), 0);
    const planLimit = await loadInitiativeLimit(db, companyId);

    const wanted = recommendationCount({
      stage: ctx.stage,
      existingCount: yours.length,
      gapToGoal: Math.max(0, revenueGoal - yoursTotal),
      planLimit,
    });

    /* ---- Ask the model to rank, then filter its answer ---- */

    let ranked = pool;
    let reasons = new Map<string, string>();
    let aiUnavailable: string | null = null;

    if (wanted > 0 && pool.length > 0) {
      const ai = await rankWithAi({ db, input, pool, ctx, horizonMonths });
      if (ai.ok) {
        // The model returns keys; anything it invented is dropped here rather
        // than trusted, and the eligibility check is re-applied because a
        // ranked list is still only a suggestion.
        const byKey = new Map(pool.map((entry) => [entry.key, entry]));
        const resolved = ai.keys
          .map((key) => byKey.get(key))
          .filter((entry): entry is LibraryInitiative => entry !== undefined)
          .filter((entry) => isEligible(entry, ctx).eligible);

        // Anything the model omitted stays available for swaps, in our order.
        const seen = new Set(resolved.map((e) => e.key));
        ranked = [...resolved, ...pool.filter((e) => !seen.has(e.key))];
        reasons = ai.reasons;
      } else {
        aiUnavailable = ai.message;
        ranked = rankHeuristically(pool);
      }
    }

    /* ---- Forecast the shortlist from benchmarks ---- */

    const benchmarkRevenue = await benchmarkRevenuePerProduct(products, horizonMonths);

    const recommended: Recommendation[] = ranked.slice(0, wanted).map((entry) => ({
      key: entry.key,
      name: entry.name,
      oneLiner: entry.oneLiner,
      category: entry.category,
      difficulty: entry.difficulty,
      speedToResults: entry.speedToResults,
      forecast: benchmarkRevenue.perInitiative,
      // Always true on this path: these are our estimates, not the user's
      // figures, and REQ-13.6 requires the card to say so.
      fromBenchmarks: true,
      why: reasons.get(entry.key) ?? null,
      productIds: benchmarkRevenue.productIds,
    }));

    const gap = goalGap({
      goal: revenueGoal,
      yours: yours.map((y) => y.forecast),
      // Nothing is accepted yet, so the recommended segment starts empty and
      // the screen recalculates as the user accepts (REQ-13.3).
      recommended: [],
    });

    return NextResponse.json({
      gap,
      goal: revenueGoal,
      horizonMonths,
      yours,
      recommended,
      /** The remaining eligible pool, for swaps (D3). */
      alternatives: ranked.slice(wanted).map((entry) => ({
        key: entry.key,
        name: entry.name,
        oneLiner: entry.oneLiner,
        category: entry.category,
        difficulty: entry.difficulty,
        speedToResults: entry.speedToResults,
        forecast: benchmarkRevenue.perInitiative,
        fromBenchmarks: true,
        why: reasons.get(entry.key) ?? null,
        productIds: benchmarkRevenue.productIds,
      })),
      planLimit,
      aiUnavailable,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake/recommend] failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ *
 * The AI step
 * ------------------------------------------------------------------ */

type RankResult =
  | { ok: true; keys: string[]; reasons: Map<string, string> }
  | { ok: false; message: string };

/**
 * Ask the model to rank the eligible pool.
 *
 * It is given ONLY the already-eligible candidates, so it cannot propose
 * something the rules have excluded — the filter runs before the prompt as well
 * as after it. That keeps the prompt shorter and means a model that ignores
 * instructions still cannot produce a forbidden recommendation.
 *
 * Returns `ok: false` rather than throwing, so the caller can fall back to our
 * own ranking. An intake must not dead-end because of a billing condition on
 * our side.
 */
async function rankWithAi(args: {
  db: SupabaseClient;
  input: Record<string, unknown>;
  pool: readonly LibraryInitiative[];
  ctx: EligibilityContext;
  horizonMonths: number;
}): Promise<RankResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "AI recommendations are not configured." };
  }

  const { input, pool, ctx, horizonMonths } = args;

  try {
    const anthropic = new Anthropic({ apiKey });
    const aiContext = await loadAiContext(args.db);

    const candidateList = renderLibraryForPrompt(
      pool.map((entry) => ({
        initiativeKey: entry.key,
        workbookId: null,
        name: entry.name,
        category: entry.category,
        difficulty: entry.difficulty,
        speedToResults: entry.speedToResults,
        oneLiner: entry.oneLiner,
        ownOrOps: entry.ownOrOps,
        priceTier: entry.priceTier,
        needsSalesTeam: entry.needsSalesTeam,
      })),
      aiContext
    );

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system:
        "You rank sales and marketing initiatives for a business.\n\n" +
        "Return ONLY a JSON array, best first:\n" +
        '[{"key":"<initiative_key verbatim>","why":"<one short sentence>"}]\n\n' +
        "Rules:\n" +
        "- Choose ONLY from the candidates given. Never invent a key.\n" +
        "- `why` speaks to THIS business in one sentence, under 18 words.\n" +
        "- Rank on fit with their audience, stage, budget and what has already " +
        "worked for them.\n" +
        "- No preamble, no code fence, no commentary.\n\n" +
        `CANDIDATES:\n${candidateList}`,
      messages: [
        {
          role: "user",
          content: describeBusiness(input, ctx, horizonMonths),
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return { ok: false, message: "The AI returned nothing usable." };
    }

    const parsed = parseRanking(block.text);
    if (parsed.length === 0) {
      return { ok: false, message: "The AI returned nothing usable." };
    }

    return {
      ok: true,
      keys: parsed.map((entry) => entry.key),
      reasons: new Map(
        parsed
          .filter((entry) => entry.why)
          .map((entry) => [entry.key, entry.why as string])
      ),
    };
  } catch (err) {
    /**
     * Classified rather than re-thrown. Credit exhaustion arrives as a 400
     * invalid_request_error — the same status and type as a malformed request —
     * so only `classifyAiFailure` separates "top up the account" from "fix the
     * prompt".
     */
    const failure = classifyAiFailure(err);
    console.error("[intake/recommend] AI ranking failed:", aiFailureLogDetail(err));
    return { ok: false, message: failure.message };
  }
}

/** The business, as the model sees it. */
function describeBusiness(
  input: Record<string, unknown>,
  ctx: EligibilityContext,
  horizonMonths: number
): string {
  const lines = [
    `Industry: ${ctx.industry ?? "not given"}${
      str(input.industry_other) ? ` (${str(input.industry_other)})` : ""
    }`,
    str(input.business_description) ? `What they do: ${str(input.business_description)}` : null,
    `Stage: ${ctx.stage ?? "not given"}`,
    `Planning period: ${horizonMonths} months`,
    `Revenue goal: ${num(input.revenue_goal) ?? "not given"}`,
    `Last 12 months: ${num(input.prior_period_revenue) ?? "not given"}`,
    `Monthly marketing budget: ${ctx.monthlyBudget ?? "not given"}`,
    `Hours a week available: ${ctx.hoursPerWeek ?? "not given"}`,
    `Who handles sales conversations: ${ctx.whoCloses ?? "not given"}`,
    `How customers buy: ${str(input.purchase_mode) ?? "not given"}`,
    str(input.sells_to) ? `Sells to: ${str(input.sells_to)}` : null,
    str(input.ideal_customer_description)
      ? `Ideal customer: ${str(input.ideal_customer_description)}`
      : null,
    str(input.problem_solved) ? `Problem solved: ${str(input.problem_solved)}` : null,
    `Email list: ${audience(input, "email_list_size", "email_list_unknown")}`,
    `Social following: ${audience(input, "social_following", "social_following_unknown")}`,
    `Monthly website visitors: ${audience(input, "monthly_visitors", "monthly_visitors_unknown")}`,
    `Past customers: ${audience(input, "past_customers", "past_customers_unknown")}`,
    `New leads a month: ${audience(input, "monthly_leads", "monthly_leads_unknown")}`,
    arr(input.borrowed_audiences).length > 0
      ? `Willing to borrow audiences via: ${arr(input.borrowed_audiences).join(", ")}`
      : null,
    arr(input.challenges).length > 0
      ? `Biggest challenges: ${arr(input.challenges).join(", ")}`
      : null,
    str(input.challenge_notes) ? `On those challenges: ${str(input.challenge_notes)}` : null,
    str(input.what_worked_notes) ? `What has worked: ${str(input.what_worked_notes)}` : null,
    // Stated explicitly even though these are already filtered out, so the
    // model does not propose a near-identical substitute.
    ctx.didntWork.length > 0
      ? `Already tried and failed: ${ctx.didntWork.join(", ")}`
      : null,
  ].filter(Boolean);

  return `Rank the candidate initiatives for this business.\n\n${lines.join("\n")}`;
}

/**
 * An audience figure, distinguishing "none" from "not sure".
 *
 * The model is told WHICH it is, because the right initiative differs: a
 * business with no list needs list-building, one that does not know its list
 * size needs measurement.
 */
function audience(
  input: Record<string, unknown>,
  field: string,
  unknownField: string
): string {
  if (input[unknownField] === true) return "they don't know";
  const value = num(input[field]);
  return value === null ? "not given" : String(value);
}

/** Parse the model's JSON, tolerating a code fence. */
function parseRanking(text: string): { key: string; why: string | null }[] {
  const attempt = (raw: string) => {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const { key, why } = entry as { key?: unknown; why?: unknown };
        if (typeof key !== "string" || key === "") return null;
        return { key, why: typeof why === "string" && why !== "" ? why : null };
      })
      .filter((e): e is { key: string; why: string | null } => e !== null);
  };

  try {
    return attempt(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return attempt(fenced[1]);
      } catch {
        return [];
      }
    }
    // Last resort: the outermost array in the response.
    const bare = text.match(/\[[\s\S]*\]/);
    if (bare) {
      try {
        return attempt(bare[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Fallback ranking
 * ------------------------------------------------------------------ */

/**
 * Our own ranking, used when the AI is unavailable.
 *
 * Fast results first, then easier to run. Someone part-way through an intake
 * needs a plan they can start on, and the two things that make an initiative
 * startable are how soon it pays and how hard it is — which are the two fields
 * the workbook actually authors for every row.
 */
function rankHeuristically(pool: readonly LibraryInitiative[]): LibraryInitiative[] {
  const speedRank = (value: string | null) => {
    const v = (value ?? "").toLowerCase();
    if (v.includes("fast")) return 0;
    if (v.includes("medium") || v.includes("moderate")) return 1;
    if (v.includes("slow")) return 2;
    return 1;
  };

  return [...pool].sort((a, b) => {
    const bySpeed = speedRank(a.speedToResults) - speedRank(b.speedToResults);
    if (bySpeed !== 0) return bySpeed;
    return (a.difficulty ?? 3) - (b.difficulty ?? 3);
  });
}

/* ------------------------------------------------------------------ *
 * Benchmark forecasting
 * ------------------------------------------------------------------ */

/**
 * A benchmark revenue figure for a recommended initiative.
 *
 * Derived from the user's OWN product goals rather than from a generic
 * conversion model: the honest estimate of what one new initiative might
 * contribute is a share of what they are already trying to sell. Inventing an
 * audience and a conversion rate for a business we have no history on would
 * produce a confident number with nothing behind it.
 *
 * Deliberately conservative — a third of the average product goal — and flagged
 * `fromBenchmarks` so the card says where it came from (REQ-13.6).
 */
async function benchmarkRevenuePerProduct(
  products: readonly Record<string, unknown>[],
  _horizonMonths: number
): Promise<{ perInitiative: number; productIds: string[] }> {
  const goals = products.map((product) => ({
    id: str(product.id) ?? "",
    goal: productGoal(num(product.average_price), num(product.units_in_period)),
  }));

  const total = goals.reduce((sum, g) => sum + g.goal, 0);
  if (total === 0 || goals.length === 0) {
    return { perInitiative: 0, productIds: goals.map((g) => g.id).filter(Boolean) };
  }

  // Attributed to the largest product, which is the one most in need of
  // additional coverage (REQ-13.11).
  const largest = goals.reduce((a, b) => (b.goal > a.goal ? b : a));

  return {
    perInitiative: Math.round((total / goals.length) / 3),
    productIds: largest.id ? [largest.id] : [],
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** The plan's `max_initiatives`, or null when unlimited (REQ-13.15). */
async function loadInitiativeLimit(
  db: SupabaseClient,
  companyId: string
): Promise<number | null> {
  const { data: subscription } = await db
    .from("subscriptions")
    .select("plan_id")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!subscription?.plan_id) return null;

  const { data: limit } = await db
    .from("plan_limits")
    .select("limit_value")
    .eq("plan_id", subscription.plan_id)
    .eq("limit_key", LIMIT_KEYS.MAX_INITIATIVES)
    .maybeSingle();

  const value = num(limit?.limit_value);
  // -1 is the unlimited convention, and a missing row fails open — same rule as
  // `checkLimit`, where denying on absent configuration is the greater harm.
  return value === null || value < 0 ? null : value;
}

async function resolveCaller() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await db
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();

  const companyId = (profile?.company_id as string | null) ?? null;
  if (!companyId) {
    return {
      error: NextResponse.json({ error: "No company on this profile yet." }, { status: 409 }),
    };
  }

  return { user, db, companyId };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toStringArray(value: unknown): string[] {
  return arr(value);
}
