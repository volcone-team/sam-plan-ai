import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import {
  loadLibrary,
  loadAiContext,
  loadInactiveInitiativeKeys,
  toLibraryInitiative,
  type ContextEntry,
} from "@/lib/workbook/read";
import { classifyAiFailure, aiFailureLogDetail } from "@/lib/ai-errors";
import { EXCLUDED_PICKER_CATEGORIES } from "@/lib/intake/schema";
import { filterEligible, isEligible, type EligibilityContext } from "@/lib/recommend/eligibility";
import { recommendationCount, recommendationCapacity } from "@/lib/recommend/sizing";
import {
  eligibilityContextFromIntake,
  loadLatestIntake,
} from "@/lib/recommend/company-eligibility";
import { loadRecommendationWeight } from "@/lib/recommend/weight-setting";
import { scoreInitiative, type InitiativeScore, type ScoredInitiative } from "@/lib/recommend/score";
import {
  parseExplanations,
  renderShortlistForPrompt,
  type ParsedExplanation,
  type RecommendationExplanation,
} from "@/lib/recommend/explain";
import { explainRanked, rankForRecommendation, type ExplainedInitiative } from "@/lib/recommend/shortlist";
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
 * FIT, THEN SCORE — THE AI EXPLAINS, IT DOES NOT CHOOSE THE ORDER.
 *
 *   1. FIT: the active library is filtered through `isEligible` (eligibility.ts).
 *   2. SCORE: the survivors are ranked by `rankByScore` with the admin's Revenue
 *      weight (score.ts, migration 041).
 *   3. The top N (sizing.ts) plus the swap reserve form the SHORTLIST.
 *   4. Only the shortlist is sent to Claude, with scores, metrics and AI
 *      Context, for per-initiative explanations. Its answer is validated
 *      against the shortlist (explain.ts) — it cannot reorder, add or remove.
 *
 * The route DEGRADES rather than failing. If the AI is unavailable the
 * explanations come from a template built from the scores and AI Context, and
 * the ORDER IS IDENTICAL, because the AI never decided it. A user part-way
 * through an intake should not hit a dead end because of a billing condition
 * on our side.
 *
 * Responses:
 *   200 { gap, yours[], recommended[], alternatives[], revenueWeight, eligibleCount,
 *         library[], planLimit, capacity, aiUnavailable }
 *       Each recommendation/alternative carries `score`, `rank` and `explanation`
 *       as well as the original fields; `why` is `explanation.whyFits`. Each
 *       library row carries `score` {total, weightedTotal, complete, missing}.
 *   401 { error: "Unauthorized" }
 *   409 { error } — no company, or no saved intake
 */

interface Recommendation {
  key: string;
  name: string;
  oneLiner: string | null;
  category: string | null;
  /** OWN / OPS as written; used to tell same-name variants apart on screen. */
  ownOrOps: string | null;
  difficulty: number | null;
  speedToResults: string | null;
  /** Expected revenue over the plan period. */
  forecast: number;
  /**
   * True when the figure came from benchmarks rather than the user's own
   * numbers, which the card must say (REQ-13.6).
   */
  fromBenchmarks: boolean;
  /** Why it fits: `explanation.whyFits`, kept for the existing card. */
  why: string | null;
  /** Product ids this initiative is suggested to sell. */
  productIds: string[];
  /** SCORE for this initiative; `missing` lists the letters counted as 3. */
  score: Pick<InitiativeScore, "total" | "weightedTotal" | "breakdown" | "complete" | "missing">;
  /** 1-based position in the SCORE ranking of the eligible pool. */
  rank: number;
  explanation: RecommendationExplanation;
}

export async function POST() {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { db, companyId } = caller;

    // The same read every FIT-aware feature uses (company-eligibility.ts).
    const intake = await loadLatestIntake(db, companyId);

    if (!intake) {
      return NextResponse.json(
        { error: "No intake answers saved yet." },
        { status: 409 }
      );
    }

    const { input, products, initiatives } = intake;

    const horizonMonths = num(input.horizon_months) ?? 12;
    const revenueGoal = num(input.revenue_goal) ?? 0;

    /* ---- The user's own initiatives, forecast ---- */

    const planned = initiatives.filter((row) => (row.source ?? "planned") === "planned");

    const yours = planned.map((row) => ({
      /**
       * The `intake_initiatives` row id.
       *
       * Carried so the recommendations screen can tell the build step WHICH of
       * the user's own initiatives to drop. Keys will not do: two of the
       * user's initiatives can share an initiative_key (two webinars for
       * different products), and an index would break the moment the draft is
       * re-read in a different order.
       */
      id: str(row.id) ?? "",
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

    /**
     * The admin allowlist, passed into eligibility as the BACKSTOP.
     *
     * loadLibrary below already filters the pool to the active set, so this is
     * belt-and-braces — but the pool is not the only way a key can reach the
     * server. A model can name an initiative it saw in an earlier prompt, and a
     * cached completion can predate a toggle change.
     */
    const inactiveKeys = (await loadInactiveInitiativeKeys(db)) ?? undefined;

    // Shared with generate-plan, Enhance, suggestions and chat.
    const ctx: EligibilityContext = eligibilityContextFromIntake(intake, inactiveKeys);

    /* ---- The candidate pool ---- */

    const excluded = new Set(EXCLUDED_PICKER_CATEGORIES.map((c) => c.toLowerCase()));
    const alreadyPlanned = new Set(yours.map((y) => y.key));

    // toLibraryInitiative carries idealIndustries, so passesIndustry reads the
    // real column (empty until a workbook that fills it is uploaded).
    const library: LibraryInitiative[] = (await loadLibrary(db))
      .filter((entry) => !excluded.has((entry.category ?? "").toLowerCase()))
      .map(toLibraryInitiative);

    // Never re-recommend something the user already planned themselves.
    const pool = filterEligible(library, ctx).filter(
      (entry) => !alreadyPlanned.has(entry.key)
    );

    /* ---- How many to offer, and how many they may keep ---- */

    // `yoursTotal` used to feed a gapToGoal argument here. Recommendations no
    // longer depend on whether the goal is covered, so it has gone with it —
    // the gap is still computed below for the GapBar.
    const planLimit = await loadInitiativeLimit(db, companyId);

    /**
     * How many ALTERNATIVES to put in front of them, and the cap on what they
     * may keep.
     *
     * These used to be the same question with one answer: "how many to add on
     * top of the user's own". They are now separate. `wanted` sizes the pool of
     * contenders — independent of how many initiatives the user already has,
     * and no longer suppressed when their plan already covers the revenue goal,
     * because a covered plan can still be a worse plan. `capacity` is the
     * number they may finish with, counting their own.
     */
    /**
     * `poolSize` is what makes Swap work.
     *
     * Alternatives are whatever the shortlist leaves behind, so asking for
     * `capacity` cards out of a pool of `capacity` leaves none and disables
     * Swap on every card before the user has done anything. Telling the sizing
     * function how much is actually available lets it hold a reserve back —
     * see SWAP_RESERVE.
     */
    const wanted = recommendationCount({ planLimit, poolSize: pool.length });
    const capacity = recommendationCapacity({ planLimit });

    console.log(
      "[intake/recommend] pool:", pool.length,
      "| shortlist:", wanted,
      "| reserved for swaps:", Math.max(0, pool.length - wanted),
      "| selection cap:", capacity
    );

    /* ---- SCORE: rank the eligible pool, then shortlist ---- */

    const revenueWeight = await loadRecommendationWeight(db);
    // Top `wanted`, then the swap reserve, in SCORE order. The rest of the
    // ranked pool stays available for swaps, also in SCORE order.
    const { ranked, shortlist } = rankForRecommendation(pool, { revenueWeight, wanted });

    /* ---- Ask the model to EXPLAIN the shortlist, then validate ---- */

    const aiContext = await loadAiContext(db);
    const contextByKey = new Map<string, ContextEntry>(aiContext.map((c) => [c.initiativeKey, c]));

    let aiUnavailable: string | null = null;
    let aiParsed: ParsedExplanation[] | null = null;

    if (shortlist.length > 0) {
      const ai = await explainWithAi({ input, shortlist, contextByKey, ctx, horizonMonths });
      if (ai.ok) aiParsed = ai.explanations;
      else aiUnavailable = ai.message;
    }

    // Keyed and ORDERED by our ranking: the model cannot reorder, add or remove.
    // The eligibility re-check is belt-and-braces — the pool is already FIT.
    const explained = explainRanked(
      ranked,
      shortlist.map((s) => s.initiative.key),
      aiParsed,
      contextByKey
    );
    const items = explained.items.filter((entry) => isEligible(entry.initiative, ctx).eligible);

    console.log(
      "[intake/recommend] weight:", revenueWeight,
      "| explained by AI:", aiParsed ? shortlist.length - explained.filled.length : 0,
      "| templated:", explained.filled.length,
      "| AI keys ignored:", explained.ignored.length
    );

    /* ---- Forecast the shortlist from benchmarks ---- */

    const benchmarkRevenue = await benchmarkRevenuePerProduct(products, horizonMonths);

    const toRecommendation = (entry: ExplainedInitiative): Recommendation => ({
      key: entry.initiative.key,
      name: entry.initiative.name,
      oneLiner: entry.initiative.oneLiner,
      category: entry.initiative.category,
      ownOrOps: entry.initiative.ownOrOps,
      difficulty: entry.initiative.difficulty,
      speedToResults: entry.initiative.speedToResults,
      forecast: benchmarkRevenue.perInitiative,
      // Always true on this path: these are our estimates, not the user's
      // figures, and REQ-13.6 requires the card to say so.
      fromBenchmarks: true,
      why: entry.explanation.whyFits || null,
      productIds: benchmarkRevenue.productIds,
      score: {
        total: entry.score.total,
        weightedTotal: entry.score.weightedTotal,
        breakdown: entry.score.breakdown,
        complete: entry.score.complete,
        missing: entry.score.missing,
      },
      rank: entry.rank,
      explanation: entry.explanation,
    });

    const recommended: Recommendation[] = items.slice(0, wanted).map(toRecommendation);

    /**
     * EVERY active initiative, for the "browse all" list under the cards.
     *
     * The owner's rule: the customer may pick any active initiative, not only
     * our shortlist. Eligibility is still computed, but as a LABEL rather than
     * a filter — an ineligible one is shown with its reason ("You told us this
     * didn't work") and stays selectable, because the customer knows their
     * business better than our rules do. The recommendations above remain
     * eligible-only.
     *
     * Same base set as the pool: active (loadLibrary) minus Maximizers.
     */
    const libraryOptions = library.map((entry) => {
      const verdict = isEligible(entry, ctx);
      // Same scoring and weight as the ranking, so the list cannot disagree
      // with the cards. Display only: this list is not re-ordered by it.
      const score = scoreInitiative(entry, { revenueWeight });
      return {
        key: entry.key,
        name: entry.name,
        category: entry.category,
        oneLiner: entry.oneLiner,
        ownOrOps: entry.ownOrOps,
        eligible: verdict.eligible,
        reason: verdict.reason,
        forecast: benchmarkRevenue.perInitiative,
        score: {
          total: score.total,
          weightedTotal: score.weightedTotal,
          complete: score.complete,
          missing: score.missing,
        },
      };
    });

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
      alternatives: items.slice(wanted).map(toRecommendation),
      /** The live Revenue weight the order was built with (1 = equal weight). */
      revenueWeight,
      /**
       * How many initiatives were ranked — the eligible pool, less what the
       * user already planned. `rank` is a position within it.
       */
      eligibleCount: ranked.length,
      /** Every active initiative, eligible or not, for the browse list. */
      library: libraryOptions,
      planLimit,
      /**
       * The most initiatives this plan may end up with, counting the user's
       * OWN. The screen uses it for the "N of 5 selected" counter and to block
       * selection past the cap; /api/intake/build re-derives it server-side
       * rather than trusting this number back.
       */
      capacity,
      aiUnavailable,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake/recommend] failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ *
 * The AI step — explanations only
 * ------------------------------------------------------------------ */

type ExplainResult =
  | { ok: true; explanations: ParsedExplanation[] }
  | { ok: false; message: string };

/**
 * Ask the model to EXPLAIN the SCORE-ranked shortlist.
 *
 * It is given ONLY the shortlist — already eligible and already ordered — with
 * each initiative's scores, metrics and AI Context. It is told not to reorder,
 * add or remove, but that instruction is not what protects the order: the
 * caller keys everything by the shortlist (mergeExplanations), so a model that
 * ignores it changes nothing but its own text.
 *
 * Returns `ok: false` rather than throwing, so the caller can fall back to the
 * template explanations. An intake must not dead-end because of a billing
 * condition on our side.
 */
async function explainWithAi(args: {
  input: Record<string, unknown>;
  shortlist: readonly ScoredInitiative<LibraryInitiative>[];
  contextByKey: ReadonlyMap<string, ContextEntry>;
  ctx: EligibilityContext;
  horizonMonths: number;
}): Promise<ExplainResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "AI recommendations are not configured." };
  }

  const { input, shortlist, contextByKey, ctx, horizonMonths } = args;

  try {
    const anthropic = new Anthropic({ apiKey });
    const candidateList = renderShortlistForPrompt(shortlist, contextByKey);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system:
        "You explain why each shortlisted sales and marketing initiative suits a business.\n\n" +
        "The SHORTLIST below is already ranked by our scoring (SCORE = Speed, Cost, Odds, " +
        "Revenue, Ease; each 1-5, 5 is best). You do NOT rank, reorder, add or remove " +
        "initiatives. Explain every one, exactly once.\n\n" +
        "Return ONLY a JSON object:\n" +
        '{"explanations":[{"key":"<initiative_key verbatim>","whyFits":"<why this fits THIS business>",' +
        '"whatToTrack":["<metric>"],"watchOutFor":"<one pitfall or null>",' +
        '"readinessQuestions":["<yes/no question>"]}]}\n\n' +
        "Rules:\n" +
        "- Use ONLY the keys given. Never invent a key.\n" +
        "- `whyFits` speaks to THIS business in 1-2 sentences, under 40 words, grounded in " +
        "its scores, its WHEN/WHY IT WORKS guidance and their answers.\n" +
        "- `whatToTrack`: 2-4 items, taken from that initiative's METRICS where listed.\n" +
        "- `watchOutFor`: one sentence drawn from its AVOID guidance, or null if none is given.\n" +
        "- `readinessQuestions`: 0-2 yes/no questions drawn from its NEEDS guidance, e.g. " +
        '"Do you have a talk that has sold from stage?"\n' +
        "- Never quote a number that is not in the data given.\n" +
        "- No preamble, no code fence, no commentary.\n\n" +
        `SHORTLIST:\n${candidateList}`,
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

    const explanations = parseExplanations(block.text);
    if (explanations.length === 0) {
      return { ok: false, message: "The AI returned nothing usable." };
    }

    return { ok: true, explanations };
  } catch (err) {
    /**
     * Classified rather than re-thrown. Credit exhaustion arrives as a 400
     * invalid_request_error — the same status and type as a malformed request —
     * so only `classifyAiFailure` separates "top up the account" from "fix the
     * prompt".
     */
    const failure = classifyAiFailure(err);
    console.error("[intake/recommend] AI explanation failed:", aiFailureLogDetail(err));
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
    // Stated so the explanations do not lean on something that already flopped.
    ctx.didntWork.length > 0
      ? `Already tried and failed: ${ctx.didntWork.join(", ")}`
      : null,
  ].filter(Boolean);

  return `Explain each shortlisted initiative for this business.\n\n${lines.join("\n")}`;
}

/**
 * An audience figure, distinguishing "none" from "not sure".
 *
 * The model is told WHICH it is, because the right advice differs: a business
 * with no list needs list-building, one that does not know its list size needs
 * measurement.
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
