/**
 * Initiative targets: units x product price.
 *
 * Client "Initiative Target Setting" spec (28 Oct 2026, Phase 1) and the
 * answers that followed it. ONE module, used by the recommendations cards, the
 * New Initiative form, the Edit form, the intake build and the conversion
 * scripts, so every screen agrees on the number.
 *
 *   share_i  = RevenueScore_i / Σ RevenueScore_j   (same product, in the plan)
 *   units_i  = round(ProductGoal x share_i / price)
 *   Good_i   = units_i x price;  Better = +10%;  Best = +20%
 *
 * Rules decided with the client (Nikhil's questions, 29 Oct):
 *   - A product with its own goal uses it. Products WITHOUT a goal share what
 *     is left of the plan goal, equally.
 *   - Leads and calls initiatives sell nothing directly: they are left out of
 *     the share and get 0 units. So is a speaker fee (paid a fee, not product
 *     sales: 1 unit at the fee).
 *   - A manual add is suggested from what is LEFT of the product goal, so
 *     adding a sixth initiative cannot push the plan over the goal. Nothing
 *     left suggests 1 unit, never 0 or negative.
 *   - A suggestion that rounds to 0 is 1.
 *   - Capacity (room capacity) caps the suggestion; the user may type more.
 *   - RECURRING IS PER OCCURRENCE (client: "$75,000 per webinar, not in
 *     total"). Units are per occurrence; the plan total is that x occurrences.
 *
 * Pure: no I/O, no React, no clock. Never throws.
 */
import { goalScenarios } from "@/lib/intake-v3/revenue";
import { NEUTRAL_SCORE, MIN_SCORE, MAX_SCORE } from "@/lib/recommend/score";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export interface TargetProduct {
  id: string;
  /** The product's price. Null or <= 0 means "no price": units are disabled. */
  price: number | null;
  /** Units the user wants to sell in the plan (products.goal_units). */
  goalUnits: number | null;
}

/** The conversion path vocabulary of the intake v3 form. */
export type TargetPath = "offer" | "calls" | "leads" | "speaker-fee";

export interface TargetItem {
  /** Any stable id: a library key on the cards, an initiative id when saved. */
  id: string;
  productId: string | null;
  /** SCORE Revenue 1-5. Blank counts as NEUTRAL_SCORE, as in the ranking. */
  revenueScore: number | null | undefined;
  path?: TargetPath | string | null;
  /** Occurrences in the plan; 1 for a one-time initiative. */
  occurrences?: number | null;
  /** Room capacity, when the initiative has one. Caps the suggestion. */
  capacity?: number | null;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function finite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** A usable price: positive and finite, else null. */
export function usablePrice(price: unknown): number | null {
  const n = finite(price);
  return n !== null && n > 0 ? n : null;
}

/** The Revenue score as used for the share: 1-5, blank = neutral 3. */
export function shareWeight(score: number | null | undefined): number {
  const n = finite(score);
  return n !== null && Number.isInteger(n) && n >= MIN_SCORE && n <= MAX_SCORE ? n : NEUTRAL_SCORE;
}

/** Whole occurrences, at least 1. */
export function occurrenceCount(occurrences: unknown): number {
  const n = finite(occurrences);
  return n !== null && n >= 1 ? Math.floor(n) : 1;
}

/** Leads and calls earn nothing directly; they are not given a revenue share. */
export function sellsNothingDirectly(path: unknown): boolean {
  return path === "leads" || path === "calls";
}

/** A speaker fee is one payment, not product sales. */
export function isFeePath(path: unknown): boolean {
  return path === "speaker-fee";
}

/** Out of the product share: leads, calls and speaker fees. */
export function outOfShare(path: unknown): boolean {
  return sellsNothingDirectly(path) || isFeePath(path);
}

/* ------------------------------------------------------------------ *
 * Product goals
 * ------------------------------------------------------------------ */

export type ProductGoalSource = "own" | "remaining" | "none";

export interface ProductGoal {
  goal: number;
  /** own = the product's units x price; remaining = a share of the plan goal. */
  source: ProductGoalSource;
}

/** A product's own goal (price x goal units), or null without one. */
export function ownProductGoal(product: TargetProduct): number | null {
  const price = usablePrice(product.price);
  const units = finite(product.goalUnits);
  if (price === null || units === null || units <= 0) return null;
  return price * units;
}

/**
 * Every product's goal for the share.
 *
 * Products with a goal use their own. Products without one split what is left
 * of the plan goal equally (client: "Products without one share whatever is
 * left of the yearly goal"). Nothing left, or no plan goal, gives them 0
 * with source "none".
 */
export function productGoals(
  products: readonly TargetProduct[],
  planGoal: number | null | undefined
): Map<string, ProductGoal> {
  const out = new Map<string, ProductGoal>();
  let ownTotal = 0;
  const without: TargetProduct[] = [];

  for (const product of products) {
    const own = ownProductGoal(product);
    if (own !== null) {
      out.set(product.id, { goal: own, source: "own" });
      ownTotal += own;
    } else {
      without.push(product);
    }
  }

  const left = Math.max(0, (finite(planGoal) ?? 0) - ownTotal);
  const each = without.length > 0 ? left / without.length : 0;
  for (const product of without) {
    out.set(product.id, each > 0 ? { goal: each, source: "remaining" } : { goal: 0, source: "none" });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Units and targets
 * ------------------------------------------------------------------ */

export type SuggestionReason =
  /** The Revenue-score share of the product goal. */
  | "share"
  /** Leads / calls: 0 units, no share. */
  | "no-direct-sales"
  /** Speaker fee: 1 unit at the fee. */
  | "fee"
  /** The share rounded to 0, or nothing was left: the 1-unit floor. */
  | "floor"
  /** Capped at the initiative's capacity. */
  | "capacity"
  /** No product, or the product has no price: nothing to suggest. */
  | "no-price";

export interface UnitSuggestion {
  /** Units per occurrence. Null when there is no usable price. */
  units: number | null;
  price: number | null;
  reason: SuggestionReason;
}

/** Round, then apply the 1-unit floor and the capacity cap. */
function finishUnits(raw: number, capacity: unknown): { units: number; reason: SuggestionReason } {
  let units = Math.round(raw);
  let reason: SuggestionReason = "share";
  if (units < 1) {
    units = 1;
    reason = "floor";
  }
  const cap = finite(capacity);
  if (cap !== null && cap >= 1 && units > Math.floor(cap)) {
    units = Math.floor(cap);
    reason = "capacity";
  }
  return { units, reason };
}

/**
 * Suggested units for every item in a plan being built (the recommendations
 * page): each gets its Revenue-score share of its product's goal.
 *
 * The denominator is the items selling the SAME product that take a share
 * (leads, calls and fees are out). Recurring items get the share per
 * occurrence, so occurrences x units still adds up to the share.
 */
export function suggestUnitsForPlan(
  items: readonly TargetItem[],
  products: readonly TargetProduct[],
  planGoal: number | null | undefined,
  /** Good already committed per product (the user's own initiatives); the share is of what is left. */
  committed?: ReadonlyMap<string, number>
): Map<string, UnitSuggestion> {
  const out = new Map<string, UnitSuggestion>();
  const byId = new Map(products.map((p) => [p.id, p]));
  const goals = productGoals(products, planGoal);
  if (committed) {
    for (const [id, used] of committed) {
      const g = goals.get(id);
      if (g) goals.set(id, { ...g, goal: Math.max(0, g.goal - Math.max(0, used)) });
    }
  }

  const weightByProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || outOfShare(item.path)) continue;
    weightByProduct.set(
      item.productId,
      (weightByProduct.get(item.productId) ?? 0) + shareWeight(item.revenueScore)
    );
  }

  for (const item of items) {
    out.set(item.id, suggestOne(item, byId, goals, weightByProduct, null));
  }
  return out;
}

/**
 * Suggested units for ONE initiative added to an existing plan (the New
 * Initiative form).
 *
 * The score share is taken among the plan's initiatives for that product plus
 * this one, then limited to what is LEFT of the product goal after the
 * existing initiatives' Good targets. Nothing left suggests 1 unit.
 */
export function suggestUnitsForNew(args: {
  item: TargetItem;
  /** The plan's other initiatives (any product); only the same product counts. */
  existing: readonly (TargetItem & { good: number | null | undefined })[];
  products: readonly TargetProduct[];
  planGoal: number | null | undefined;
}): UnitSuggestion {
  const byId = new Map(args.products.map((p) => [p.id, p]));
  const goals = productGoals(args.products, args.planGoal);
  const productId = args.item.productId;

  let weight = outOfShare(args.item.path) ? 0 : shareWeight(args.item.revenueScore);
  let committed = 0;
  for (const other of args.existing) {
    if (!productId || other.productId !== productId) continue;
    committed += Math.max(0, finite(other.good) ?? 0);
    if (!outOfShare(other.path)) weight += shareWeight(other.revenueScore);
  }

  const goal = productId ? goals.get(productId)?.goal ?? 0 : 0;
  const remaining = Math.max(0, goal - committed);
  return suggestOne(
    args.item,
    byId,
    goals,
    new Map(productId ? [[productId, weight]] : []),
    remaining
  );
}

function suggestOne(
  item: TargetItem,
  products: ReadonlyMap<string, TargetProduct>,
  goals: ReadonlyMap<string, ProductGoal>,
  weightByProduct: ReadonlyMap<string, number>,
  remaining: number | null
): UnitSuggestion {
  const product = item.productId ? products.get(item.productId) : undefined;
  const price = usablePrice(product?.price);

  if (sellsNothingDirectly(item.path)) return { units: 0, price, reason: "no-direct-sales" };
  if (price === null) return { units: null, price: null, reason: "no-price" };
  if (isFeePath(item.path)) return { units: 1, price, reason: "fee" };

  const goal = goals.get(product!.id)?.goal ?? 0;
  const total = weightByProduct.get(product!.id) ?? 0;
  let dollars = total > 0 ? (goal * shareWeight(item.revenueScore)) / total : 0;
  if (remaining !== null) dollars = Math.min(dollars, remaining);

  const perOccurrence = dollars / occurrenceCount(item.occurrences) / price;
  const { units, reason } = finishUnits(perOccurrence, item.capacity);
  return { units, price, reason };
}

/* ------------------------------------------------------------------ *
 * From units to stored figures, and back
 * ------------------------------------------------------------------ */

export interface UnitTarget {
  /** Good / Better / Best for the WHOLE plan (all occurrences). */
  good: number;
  better: number;
  best: number;
  /** Good for one occurrence (= units x price). */
  perOccurrence: number;
  occurrences: number;
}

/**
 * The stored figures for units at a price.
 *
 * Good per occurrence = units x price; the plan total multiplies by the
 * occurrences. Better and Best are +10% / +20% of the TOTAL, through the same
 * goalScenarios every form uses, so the rounding matches.
 */
export function targetFromUnits(args: {
  units: number | null | undefined;
  price: number | null | undefined;
  occurrences?: number | null;
}): UnitTarget {
  const occurrences = occurrenceCount(args.occurrences);
  const units = Math.max(0, finite(args.units) ?? 0);
  const price = usablePrice(args.price) ?? 0;
  const perOccurrence = Math.round(units * price * 100) / 100;
  const total = Math.round(perOccurrence * occurrences * 100) / 100;
  const scenarios = goalScenarios(total);
  return scenarios.ok
    ? { ...scenarios.scenarios, perOccurrence, occurrences }
    : { good: 0, better: 0, best: 0, perOccurrence, occurrences };
}

/**
 * Units for an older target that has dollars but no units (the one-off
 * conversion): Good per occurrence / price, rounded. Null without a price.
 */
export function unitsFromDollars(args: {
  good: number | null | undefined;
  price: number | null | undefined;
  occurrences?: number | null;
}): number | null {
  const price = usablePrice(args.price);
  if (price === null) return null;
  const good = Math.max(0, finite(args.good) ?? 0);
  return Math.round(good / occurrenceCount(args.occurrences) / price);
}

/** The source label stored with a target. */
export type TargetSource = "suggested" | "edited" | "migrated";

/** "suggested" when the user kept the suggestion, otherwise "edited". */
export function targetSourceFor(units: number | null, suggested: number | null): "suggested" | "edited" {
  return units !== null && suggested !== null && units === suggested ? "suggested" : "edited";
}
