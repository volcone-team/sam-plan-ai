/**
 * The six generator rules (REQ-13.8 to REQ-13.12), as pure predicates.
 *
 * THE AI PROPOSES; THIS DECIDES. The model is asked for ranked candidates and
 * every one is then passed through `isEligible` server-side. Prompt
 * instructions are not enforcement — a model can ignore them, and recommending
 * a sales-call initiative to someone who has just said they take no sales calls
 * is the kind of error that discredits the entire plan rather than one card.
 *
 * Each rule is its own function so it can be tested in isolation and so a
 * failure names which rule rejected an initiative. That reason is surfaced: a
 * silent filter looks like a missing feature when someone asks why their
 * webinar was not suggested.
 */

import { requiresSalesCalls, type LibraryInitiative } from "@/lib/intake/library";
import { BROAD_FIT, INDUSTRY_OTHER } from "@/lib/intake/schema";

export interface EligibilityContext {
  /** One of the 13 industries, or "Other". */
  industry: string | null;
  /** Library keys the user said did not work (REQ-13.8). */
  didntWork: readonly string[];
  /** Monthly marketing budget in dollars. 0 is a real answer. */
  monthlyBudget: number | null;
  /** Hours a week available. Null means they did not say. */
  hoursPerWeek: number | null;
  /** `planning_inputs.sales_owner`. */
  whoCloses: string | null;
  /** `planning_inputs.growth_stage`. */
  stage: string | null;
}

export interface EligibilityVerdict {
  eligible: boolean;
  /** Which rule rejected it, for display and for debugging a thin shortlist. */
  reason: string | null;
}

const ELIGIBLE: EligibilityVerdict = { eligible: true, reason: null };

function reject(reason: string): EligibilityVerdict {
  return { eligible: false, reason };
}

/* ------------------------------------------------------------------ *
 * REQ-13.8 — nothing they have already tried and abandoned
 * ------------------------------------------------------------------ */

/**
 * The strongest signal in the intake, and the only ABSOLUTE rule here.
 *
 * Recommending something the user explicitly told us flopped is worse than
 * recommending nothing: it proves the plan did not read their answers. No
 * budget or industry consideration overrides it.
 */
export function passesDidntWork(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  return ctx.didntWork.includes(initiative.key)
    ? reject("You told us this one didn't work for you.")
    : ELIGIBLE;
}

/* ------------------------------------------------------------------ *
 * REQ-13.9 — within budget and available hours
 * ------------------------------------------------------------------ */

/**
 * Initiatives that cannot run without ad spend.
 *
 * Keyed explicitly rather than inferred from the workbook, because
 * `wb_ai_context.min_budget` is free text ("$500-1000/mo", "varies") and
 * parsing money out of prose to gate a recommendation would fail in both
 * directions. A short list of known-paid initiatives is honest about what we
 * actually know.
 */
const REQUIRES_PAID_SPEND = new Set(["paid-ads"]);

/** Below this, paid initiatives are not recommended. */
export const MIN_BUDGET_FOR_PAID = 1;

/**
 * Difficulty above which an initiative needs real weekly time.
 *
 * The workbook rates 1-5. A 5 is "Hybrid Events" — a flagship production — and
 * recommending one to someone with five hours a week sets them up to fail
 * publicly.
 */
export const HIGH_EFFORT_DIFFICULTY = 4;

/** Hours a week below which high-effort initiatives are excluded. */
export const MIN_HOURS_FOR_HIGH_EFFORT = 10;

export function passesCapacity(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  if (REQUIRES_PAID_SPEND.has(initiative.key)) {
    const budget = ctx.monthlyBudget ?? 0;
    if (budget < MIN_BUDGET_FOR_PAID) {
      return reject("This needs an ad budget, and you told us yours is $0.");
    }
  }

  const difficulty = initiative.difficulty ?? 0;
  /**
   * A null `hoursPerWeek` does NOT exclude. The field is optional, and treating
   * "did not say" as "has no time" would strip the hardest-working initiatives
   * from everyone who skipped it — exactly the opposite of the null-is-not-zero
   * rule the rest of the intake follows.
   */
  if (
    difficulty >= HIGH_EFFORT_DIFFICULTY &&
    ctx.hoursPerWeek !== null &&
    ctx.hoursPerWeek < MIN_HOURS_FOR_HIGH_EFFORT
  ) {
    return reject(
      `This takes more than ${ctx.hoursPerWeek} hours a week to run properly.`
    );
  }

  return ELIGIBLE;
}

/* ------------------------------------------------------------------ *
 * REQ-13.10 — no sales-call initiatives when they take no calls
 * ------------------------------------------------------------------ */

export const NO_SALES_CALLS = "no_sales_calls";

/**
 * Only an explicit YES in the workbook counts as requiring calls.
 *
 * Most of the library is marked POSSIBLY, and treating that as YES would leave
 * a self-serve business with almost nothing to recommend — the rule would stop
 * protecting them and start blocking them.
 */
export function passesSalesModel(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  if (ctx.whoCloses !== NO_SALES_CALLS) return ELIGIBLE;

  return requiresSalesCalls(initiative)
    ? reject("This needs someone to take sales calls.")
    : ELIGIBLE;
}

/* ------------------------------------------------------------------ *
 * REQ-13.12 — industry eligibility, honouring Broad fit
 * ------------------------------------------------------------------ */

/**
 * Industry fit.
 *
 * The library has no "Ideal Industries" column yet — see the note in
 * `funnel.ts` about the same gap. Until it is authored, EVERY initiative is
 * treated as Broad fit, which REQ-4.2 already makes the correct default for
 * "Other" and is the only honest reading of an absent column.
 *
 * This is deliberately a real function rather than an omitted rule, so when the
 * column lands there is one place to implement it and a test already asserting
 * the Broad-fit behaviour.
 */
export function passesIndustry(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  const idealIndustries = readIdealIndustries(initiative);

  // No authored restriction means it suits everyone.
  if (idealIndustries.length === 0) return ELIGIBLE;

  // REQ-4.2 — Broad fit stays eligible for every industry, "Other" included.
  if (idealIndustries.some((value) => value.toLowerCase() === BROAD_FIT.toLowerCase())) {
    return ELIGIBLE;
  }

  // "Other" is not in the library's vocabulary, so only Broad fit can match it.
  if (!ctx.industry || ctx.industry === INDUSTRY_OTHER) {
    return reject("This one is tailored to industries we don't have you down as.");
  }

  const matches = idealIndustries.some(
    (value) => value.trim().toLowerCase() === ctx.industry!.trim().toLowerCase()
  );

  return matches
    ? ELIGIBLE
    : reject(`This one works best outside ${ctx.industry}.`);
}

/**
 * Read the ideal-industry list off a library row.
 *
 * Tolerant of shape because the column does not exist yet: when the workbook
 * gains it, it may arrive as an array or as a comma-separated string, and
 * neither should require a code change here to be read.
 */
function readIdealIndustries(initiative: LibraryInitiative): string[] {
  const raw = (initiative as { idealIndustries?: unknown }).idealIndustries;

  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.split(/[,;|]/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

/** The rules, in the order they are applied. */
const RULES = [
  passesDidntWork,
  passesSalesModel,
  passesCapacity,
  passesIndustry,
] as const;

/**
 * Is this initiative eligible for this user?
 *
 * Rules run in order of how DEFINITIVE they are, and the first rejection wins,
 * so the reason the user sees is the most decisive one. "You told us this
 * didn't work" is a better explanation than "this works best outside your
 * industry" when both are true.
 */
export function isEligible(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  for (const rule of RULES) {
    const verdict = rule(initiative, ctx);
    if (!verdict.eligible) return verdict;
  }
  return ELIGIBLE;
}

/** Everything eligible, in the order given. */
export function filterEligible(
  initiatives: readonly LibraryInitiative[],
  ctx: EligibilityContext
): LibraryInitiative[] {
  return initiatives.filter((initiative) => isEligible(initiative, ctx).eligible);
}

/* ------------------------------------------------------------------ *
 * REQ-13.11 — coverage of the products carrying the goal
 * ------------------------------------------------------------------ */

/** Share of the goal above which a product needs two initiatives behind it. */
export const DOMINANT_PRODUCT_SHARE = 0.5;

export const MIN_INITIATIVES_FOR_DOMINANT_PRODUCT = 2;

export interface ProductCoverage {
  productId: string;
  name: string;
  /** This product's share of the planned revenue, 0-1. */
  share: number;
  initiativeCount: number;
  /** True when it carries over half the goal on fewer than two initiatives. */
  underCovered: boolean;
}

/**
 * Which products are carrying too much on too little.
 *
 * REQ-13.11 is a rule about the SHAPE of the plan rather than about any one
 * initiative, so it cannot be a predicate like the others — it is reported
 * here and used to steer what gets added. A product carrying most of the goal
 * behind a single initiative is the plan's single point of failure: if that one
 * campaign underperforms, the whole year misses.
 */
export function productCoverage(
  products: readonly { id: string; name: string; goal: number }[],
  initiativesByProduct: ReadonlyMap<string, number>
): ProductCoverage[] {
  const total = products.reduce((sum, product) => sum + Math.max(0, product.goal), 0);

  return products.map((product) => {
    const share = total > 0 ? Math.max(0, product.goal) / total : 0;
    const initiativeCount = initiativesByProduct.get(product.id) ?? 0;

    return {
      productId: product.id,
      name: product.name,
      share,
      initiativeCount,
      underCovered:
        share > DOMINANT_PRODUCT_SHARE &&
        initiativeCount < MIN_INITIATIVES_FOR_DOMINANT_PRODUCT,
    };
  });
}
