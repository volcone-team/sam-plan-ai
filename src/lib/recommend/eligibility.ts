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
import {
  describeTierRange,
  parseInitiativeTierRange,
  type PriceTier,
} from "@/lib/recommend/price-tier";

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
  /**
   * Initiative keys the admin has switched off (migration 034).
   *
   * The DISABLED set rather than the allowed one, so a key with no settings row
   * stays eligible — a freshly uploaded workbook must work before anyone has
   * visited the admin screen. Undefined means no allowlist is in force, which
   * is also what happens when the settings table cannot be read: the AI gets
   * too many options rather than none.
   */
  inactiveKeys?: ReadonlySet<string>;
  /**
   * Price tiers of what the business sells, for the FIT "I" gate
   * (passesPriceTier). One entry per product whose tier is known; products
   * with no price and no usable price level are left out.
   *
   * There is no "focus product" flag anywhere in the intake or the products
   * table, so this is EVERY intake product and the business passes when ANY
   * of them matches. Undefined or empty means unknown, and nothing is removed.
   */
  productTiers?: readonly PriceTier[];
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
  /**
   * A null budget does NOT exclude, same as null hours below. It used to be
   * read as $0, which made an all-null context (a company with no v2 intake,
   * now that FIT runs in generate-plan, Enhance, suggestions and chat) reject
   * paid ads with "you told us yours is $0" — something they never said. The
   * intake requires the field, so a real intake is unaffected.
   */
  if (REQUIRES_PAID_SPEND.has(initiative.key) && ctx.monthlyBudget !== null) {
    if (ctx.monthlyBudget < MIN_BUDGET_FOR_PAID) {
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
 * Reads `idealIndustries` (the Oct 2026 workbook's "Ideal Industries",
 * migration 040). An initiative with none authored — every row of an older
 * workbook, or a database without 040 — is treated as Broad fit, which REQ-4.2
 * already makes the correct default for "Other" and is the only honest reading
 * of an absent column. So this filters only once a workbook that fills the
 * column has been uploaded.
 */
export function passesIndustry(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  const idealIndustries = readIdealIndustries(initiative);

  // No authored restriction means it suits everyone.
  if (idealIndustries.length === 0) return ELIGIBLE;

  // REQ-4.2 — Broad fit stays eligible for every industry, "Other" included.
  if (idealIndustries.some(isBroadFit)) return ELIGIBLE;

  /**
   * Industry not known (no v2 intake) does not exclude: nothing was said that
   * rules this out. It used to reject, which made an all-null context filter
   * every industry-tailored initiative once FIT ran outside the intake.
   */
  if (!ctx.industry) return ELIGIBLE;

  // "Other" is not in the library's vocabulary, so only Broad fit can match it.
  if (normaliseIndustry(ctx.industry) === normaliseIndustry(INDUSTRY_OTHER)) {
    return reject("This one is tailored to industries we don't have you down as.");
  }

  const wanted = normaliseIndustry(ctx.industry);
  const matches = idealIndustries.some((value) => normaliseIndustry(value) === wanted);

  return matches
    ? ELIGIBLE
    : reject(`This one works best outside ${ctx.industry}.`);
}

/**
 * Comparable form of an industry label: case, whitespace, "&" vs "and" and
 * hyphenation are formatting, not meaning. "Health & Wellness",
 * "health and wellness" and "Health  &Wellness" all compare equal, as do
 * "E-commerce" / "Ecommerce" and "Faith-Based" / "Faith Based".
 *
 * Deliberately no synonym table: every value in the Oct 2026 workbook's
 * "Ideal Industries" column already matches INDUSTRIES once normalised, and a
 * table of guesses would quietly widen eligibility.
 */
export function normaliseIndustry(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\s\-_]+/g, "");
}

/**
 * Is this "Ideal Industries" value the Broad-fit tag?
 *
 * Prefix match, because the workbook writes the tag with an explanation
 * ("Broad fit — works in most industries") while the intake constant is the
 * bare "Broad fit". Anything that starts with it counts.
 */
export function isBroadFit(value: string): boolean {
  return value.trim().toLowerCase().startsWith(BROAD_FIT.toLowerCase());
}

/**
 * Read the ideal-industry list off a library row.
 *
 * The typed field is `idealIndustries: string[]`, populated from
 * wb_initiative_library.ideal_industries (migration 040) by loadLibrary /
 * toLibraryInitiative. Still tolerant of a delimited string at runtime, in
 * case a row reaches here from JSON that was never through the loader.
 */
function readIdealIndustries(initiative: LibraryInitiative): string[] {
  const raw: unknown = initiative.idealIndustries;

  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.split(/[,;|]/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * FIT "I" — it's the right product (price tier)
 * ------------------------------------------------------------------ */

/**
 * Does what the business sells sit in the price tier this initiative sells
 * best?
 *
 * The initiative's tier is a RANGE ("Low → Mid" covers both), and the business
 * passes when ANY of its products' tiers falls inside it — there is no focus
 * product to single out (see EligibilityContext.productTiers).
 *
 * Lenient on missing data in both directions: a blank or unparseable workbook
 * tier, or a business whose products have no price, removes nothing. This gate
 * exists to stop a $27 ebook being handed a high-ticket closing play, not to
 * punish a skipped field.
 */
export function passesPriceTier(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  const range = parseInitiativeTierRange(initiative.priceTier);
  if (!range) return ELIGIBLE;

  const tiers = ctx.productTiers ?? [];
  if (tiers.length === 0) return ELIGIBLE;

  return tiers.some((tier) => range.has(tier))
    ? ELIGIBLE
    : reject(
        `This one works best for ${describeTierRange(range)} offers, and yours are ${describeTierRange(new Set(tiers))}.`
      );
}

/* ------------------------------------------------------------------ *
 * Admin allowlist — the initiative must be switched on
 * ------------------------------------------------------------------ */

/**
 * Is this initiative one the admin has allowed the AI to use?
 *
 * `loadLibrary` already filters the candidate pool to the active set, so in the
 * normal path this rule never fires. It exists as the BACKSTOP, in the same
 * spirit as the rest of this module: the pool and the prompt are not
 * enforcement. An initiative key can reach the server from places that never
 * touched the filtered pool —
 *
 *   - a model response naming a key it remembered from an earlier prompt,
 *   - a retried or cached completion built before the admin changed a toggle,
 *   - a client posting a key directly.
 *
 * Checked FIRST, because "we do not offer this" outranks every other reason:
 * telling someone a disabled initiative is outside their industry invites them
 * to argue about their industry.
 *
 * `inactiveKeys` is undefined when the caller has no settings to apply, which
 * leaves behaviour exactly as it was before the allowlist existed.
 */
export function passesActiveAllowlist(
  initiative: LibraryInitiative,
  ctx: EligibilityContext
): EligibilityVerdict {
  if (!ctx.inactiveKeys || ctx.inactiveKeys.size === 0) return ELIGIBLE;
  return ctx.inactiveKeys.has(initiative.key)
    ? reject("This initiative isn't currently offered.")
    : ELIGIBLE;
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

/**
 * The rules, in the order they are applied. The FIT gates are industry (F),
 * price tier (I) and sales model (T); the rest are the intake's own rules.
 */
const RULES = [
  passesActiveAllowlist,
  passesDidntWork,
  passesSalesModel,
  passesCapacity,
  passesIndustry,
  passesPriceTier,
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
