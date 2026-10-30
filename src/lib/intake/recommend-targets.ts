/**
 * Targets for the recommendations page ("Here's where we'd start").
 *
 * Client "Initiative Target Setting" spec, Screen 1: every card sells ONE
 * product (a dropdown on the card) and its target is units x that product's
 * price. Units are suggested from the card's Revenue-score share of the
 * product goal, among the cards in the plan that sell the same product, and
 * the user may edit them once the card is added.
 *
 *   - A card NOT yet added shows what it would be suggested IF added: the
 *     share is taken over the added cards plus this one.
 *   - Adding, removing, swapping or changing a card's product re-runs the
 *     share for that product, so the suggestions always add up to its goal.
 *   - An edited unit count sticks until the product changes (spec: "User
 *     changes product after editing units: recompute suggestion and overwrite
 *     units"); the page drops the edit when the product changes.
 *
 * Pure: the page renders it and the build route re-derives the same figures
 * server-side, so the client cannot post a target of its own.
 */
import {
  suggestUnitsForPlan,
  ownProductGoal,
  targetFromUnits,
  usablePrice,
  type SuggestionReason,
  type TargetProduct,
} from "@/lib/planning/targets";

export interface CardTarget {
  productId: string | null;
  price: number | null;
  /** The formula's suggestion. Null without a usable price. */
  suggestedUnits: number | null;
  /** What counts: the edited units when there are any, else the suggestion. */
  units: number | null;
  /** units x price. 0 without a price. */
  good: number;
  better: number;
  best: number;
  reason: SuggestionReason;
  /** True when the user typed the units. */
  edited: boolean;
  /**
   * The product has no goal of its own, so the suggestion came from the plan
   * (annual) goal. The spec's hint: "Based on your annual goal".
   */
  fromAnnualGoal: boolean;
}

/** A typed unit count, or null when blank or unusable. */
export function parseUnits(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function cardTargets(args: {
  /** Keys in the plan (added), in order. */
  selected: readonly string[];
  /** Every key a card or list row shows; not-added ones get an "if added" figure. */
  shown: readonly string[];
  revenueScoreByKey: ReadonlyMap<string, number | null | undefined>;
  /** The product each key sells (the card's dropdown). */
  productByKey: ReadonlyMap<string, string | null>;
  /** Units the user typed, by key. */
  unitsByKey: ReadonlyMap<string, string>;
  products: readonly TargetProduct[];
  planGoal: number | null | undefined;
  /** Occurrences per key (recurring): units are per occurrence, Good multiplies. */
  occurrencesByKey?: ReadonlyMap<string, number>;
  /**
   * The user's OWN initiatives with a funnel: their units come from it (one
   * run's revenue / price), not from the share. Their Good is taken off the
   * product goal before the recommendations share what is left.
   */
  fixed?: readonly { key: string; perRun: number }[];
}): Map<string, CardTarget> {
  const out = new Map<string, CardTarget>();
  const priceOf = (id: string | null) => usablePrice(args.products.find((p) => p.id === id)?.price);
  const occurrencesOf = (key: string) => args.occurrencesByKey?.get(key) ?? 1;
  const item = (key: string) => ({
    id: key,
    productId: args.productByKey.get(key) ?? null,
    revenueScore: args.revenueScoreByKey.get(key) ?? null,
    occurrences: occurrencesOf(key),
  });

  const finish = (key: string, suggestion: { units: number | null; reason: SuggestionReason }): CardTarget => {
    const productId = args.productByKey.get(key) ?? null;
    const price = priceOf(productId);
    const typed = parseUnits(args.unitsByKey.get(key));
    const units = price === null ? null : typed ?? suggestion.units;
    const t = targetFromUnits({ units, price, occurrences: occurrencesOf(key) });
    return {
      productId,
      price,
      suggestedUnits: suggestion.units,
      units,
      good: t.good,
      better: t.better,
      best: t.best,
      reason: suggestion.reason,
      edited: typed !== null && typed !== suggestion.units,
      fromAnnualGoal: productId !== null && price !== null && ownProductGoal(args.products.find((p) => p.id === productId)!) === null,
    };
  };

  // Own initiatives with a funnel first: fixed units, committed Good.
  const committed = new Map<string, number>();
  const fixedKeys = new Set<string>();
  for (const f of args.fixed ?? []) {
    const price = priceOf(args.productByKey.get(f.key) ?? null);
    const suggested = price !== null && f.perRun > 0 ? Math.max(1, Math.round(f.perRun / price)) : null;
    if (suggested === null) continue;
    fixedKeys.add(f.key);
    const target = finish(f.key, { units: suggested, reason: "share" });
    out.set(f.key, target);
    if (target.productId) committed.set(target.productId, (committed.get(target.productId) ?? 0) + target.good);
  }

  const selected = args.selected.filter((k) => !fixedKeys.has(k));
  const selectedSet = new Set(args.selected);
  const inPlan = suggestUnitsForPlan(selected.map(item), args.products, args.planGoal, committed);

  for (const key of selected) {
    out.set(key, finish(key, inPlan.get(key) ?? { units: null, reason: "no-price" }));
  }
  for (const key of args.shown) {
    if (selectedSet.has(key) || out.has(key)) continue;
    const ifAdded = suggestUnitsForPlan([...selected, key].map(item), args.products, args.planGoal, committed);
    out.set(key, finish(key, ifAdded.get(key) ?? { units: null, reason: "no-price" }));
  }
  return out;
}
