import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadInactiveInitiativeKeys,
  toLibraryInitiative,
  type LibraryEntry,
} from "@/lib/workbook/read";
import { isEligible, type EligibilityContext } from "@/lib/recommend/eligibility";
import { intakeProductTier, type PriceTier } from "@/lib/recommend/price-tier";
import { rankByScore } from "@/lib/recommend/score";
import { loadRecommendationWeight } from "@/lib/recommend/weight-setting";

/**
 * FIT for a COMPANY, from its stored intake — one implementation for every
 * feature that lets the AI pick initiatives: intake recommendations,
 * generate-plan, Enhance, plan suggestions and chat.
 *
 * The context is built from the latest v2 intake:
 *   planning_inputs  industry, sales_owner, monthly_marketing_budget,
 *                    weekly_hours, growth_stage
 *   intake_initiatives with source = "failed"  the didn't-work list
 *   intake_products  price tiers (FIT "I")
 *
 * NO INTAKE IS NOT AN ERROR. An older company without a v2 intake gets an
 * all-null context, and every rule passes on null (see eligibility.ts), so
 * only the admin allowlist filters. Read failures behave the same way: FIT
 * fails OPEN, because a too-wide library is a far cheaper failure than an AI
 * with nothing to choose from.
 */

export interface IntakeSnapshot {
  /** The latest `planning_inputs` row with intake_version = 2. */
  input: Record<string, unknown>;
  products: Record<string, unknown>[];
  initiatives: Record<string, unknown>[];
}

/** The latest v2 intake for a company, or null when it has none. */
export async function loadLatestIntake(
  db: SupabaseClient,
  companyId: string
): Promise<IntakeSnapshot | null> {
  const { data: input, error } = await db
    .from("planning_inputs")
    .select("*")
    .eq("company_id", companyId)
    .eq("intake_version", 2)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[recommend/company-eligibility] intake read failed:", error.message);
    return null;
  }
  if (!input) return null;

  const planningInputId = (input as Record<string, unknown>).id as string;

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

  return {
    input: input as Record<string, unknown>,
    products: (productRows ?? []) as Record<string, unknown>[],
    initiatives: (initiativeRows ?? []) as Record<string, unknown>[],
  };
}

/**
 * The eligibility context for an intake. Pure.
 *
 * Extracted verbatim from /api/intake/recommend so that route and every other
 * feature build FIT the same way. Null intake gives the all-null context.
 */
export function eligibilityContextFromIntake(
  intake: IntakeSnapshot | null,
  inactiveKeys?: ReadonlySet<string>
): EligibilityContext {
  if (!intake) {
    return {
      industry: null,
      didntWork: [],
      monthlyBudget: null,
      hoursPerWeek: null,
      whoCloses: null,
      stage: null,
      inactiveKeys,
      productTiers: [],
    };
  }

  const { input, products, initiatives } = intake;

  const didntWork = initiatives
    .filter((row) => row.source === "failed")
    .map((row) => str(row.initiative_key))
    .filter((key): key is string => key !== null);

  return {
    industry: str(input.industry),
    didntWork,
    monthlyBudget: num(input.monthly_marketing_budget),
    hoursPerWeek: num(input.weekly_hours),
    whoCloses: str(input.sales_owner),
    stage: str(input.growth_stage),
    inactiveKeys,
    // FIT "I": every intake product's tier (there is no focus flag); a
    // product with no price and no usable level contributes nothing.
    productTiers: products
      .map((row) => intakeProductTier(row))
      .filter((tier): tier is PriceTier => tier !== null),
  };
}

/** Context for a company, loading its intake and the admin allowlist. Never throws. */
export async function loadCompanyEligibilityContext(
  db: SupabaseClient,
  companyId: string | null | undefined
): Promise<EligibilityContext> {
  try {
    const [intake, inactive] = await Promise.all([
      companyId ? loadLatestIntake(db, companyId) : Promise.resolve(null),
      loadInactiveInitiativeKeys(db),
    ]);
    return eligibilityContextFromIntake(intake, inactive ?? undefined);
  } catch (err: unknown) {
    console.error(
      "[recommend/company-eligibility] context failed, FIT not applied:",
      err instanceof Error ? err.message : String(err)
    );
    return eligibilityContextFromIntake(null);
  }
}

export interface PartitionedLibrary {
  /** Eligible entries, ranked best first by SCORE. */
  eligible: LibraryEntry[];
  /** Ineligible entries with the rule's reason, in library order. */
  ineligible: { entry: LibraryEntry; reason: string }[];
}

/** Split the library by FIT and rank the survivors by SCORE. Pure. */
export function partitionLibrary(
  library: readonly LibraryEntry[],
  ctx: EligibilityContext,
  revenueWeight: number
): PartitionedLibrary {
  const eligible: LibraryEntry[] = [];
  const ineligible: { entry: LibraryEntry; reason: string }[] = [];
  for (const entry of library) {
    const verdict = isEligible(toLibraryInitiative(entry), ctx);
    if (verdict.eligible) eligible.push(entry);
    else ineligible.push({ entry, reason: verdict.reason ?? "Not a fit for this business." });
  }
  return { eligible: rankByScore(eligible, { revenueWeight }), ineligible };
}

/**
 * Why an AI-chosen library key must be rejected, or null when it may be used.
 *
 * `entry` is the key's library row from ANY library read (inactive included),
 * so a disabled initiative is rejected by the allowlist rule. A key with no
 * library row returns null: it is not a library pick, and each caller already
 * has its own rule for those.
 */
export function rejectionReason(
  entry: LibraryEntry | null | undefined,
  ctx: EligibilityContext
): string | null {
  if (!entry) return null;
  const verdict = isEligible(toLibraryInitiative(entry), ctx);
  return verdict.eligible ? null : verdict.reason ?? "Not a fit for this business.";
}

/** Context + weight for a company: what every AI feature needs for FIT then SCORE. */
export async function loadCompanyFit(
  db: SupabaseClient,
  companyId: string | null | undefined
): Promise<{ ctx: EligibilityContext; revenueWeight: number }> {
  const [ctx, revenueWeight] = await Promise.all([
    loadCompanyEligibilityContext(db, companyId),
    loadRecommendationWeight(db),
  ]);
  return { ctx, revenueWeight };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
