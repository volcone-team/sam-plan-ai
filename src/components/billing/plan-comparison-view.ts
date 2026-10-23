/**
 * Pure display derivations for the plan comparison table on /get-started and
 * /choose-plan (component: plan-comparison.tsx). No React, no I/O, so the
 * figures a prospect reads are unit-tested here rather than in markup.
 *
 * Units: table figures (rows, cells, compare-at, annual note) are INTEGER
 * CENTS; plan prices are DOLLARS, as subscription_plans stores them.
 */

import {
  compareAt,
  sectionTotal,
  type BillingCycle,
  type PricingCell,
  type PricingSection,
  type PricingTable,
  type PricingTableSection,
} from "@/lib/billing/pricing-table";

export type { BillingCycle };

/** A plan as the comparison component shows it: table extras + purchase flags. */
export interface ComparisonPlan {
  id: string;
  name: string;
  /** Dollars. */
  monthlyPrice: number;
  /** Dollars. */
  annualPrice: number;
  compareAtMonthlyCents: number | null;
  priceLabel: string | null;
  purchasableMonthly: boolean;
  purchasableAnnual: boolean;
}

/** The fields the pages already compute for each offered plan. */
export interface OfferedPlanInput {
  id: string;
  monthlyPrice: number;
  annualPrice: number;
  purchasableMonthly: boolean;
  purchasableAnnual: boolean;
}

/**
 * Plans to show: those in BOTH the table and the page's offered list, matched
 * by id, in table order. Prices and purchasability come from the page (the
 * same values the fallback cards use); compare-at and label from the table.
 */
export function selectComparisonPlans(
  table: Pick<PricingTable, "plans">,
  offered: readonly OfferedPlanInput[]
): ComparisonPlan[] {
  const byId = new Map(offered.map((p) => [p.id, p]));
  const out: ComparisonPlan[] = [];
  for (const t of table.plans) {
    const o = byId.get(t.id);
    if (!o) continue;
    out.push({
      id: t.id,
      name: t.name,
      monthlyPrice: o.monthlyPrice,
      annualPrice: o.annualPrice,
      compareAtMonthlyCents: t.compare_at_monthly_cents,
      priceLabel: t.price_label,
      purchasableMonthly: o.purchasableMonthly,
      purchasableAnnual: o.purchasableAnnual,
    });
  }
  return out;
}

/** Dollars, whole when whole ("$1,188"), else to the cent ("$40.83"). */
export function formatDollars(dollars: number): string {
  if (!Number.isFinite(dollars)) return "$0";
  const cents = Math.round(dollars * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  if (abs % 100 === 0) return `${sign}$${(abs / 100).toLocaleString("en-US")}`;
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCents(cents: number): string {
  return formatDollars(cents / 100);
}

/**
 * The monthly cost of an annual price, rounded to the cent ($490 → $40.83).
 * To the cent rather than to the dollar: rounding $40.83 to "$41" overstates
 * and rounding down to "$40" understates what someone pays.
 */
export function monthlyEquivalent(annualDollars: number): number {
  return Math.round((annualDollars * 100) / 12) / 100;
}

export interface PriceLines {
  /** Crossed-out figure, or null when there is none (or it is no discount). */
  strike: string | null;
  /** The price for the selected cycle. */
  price: string;
  /** Small line under the price, or null. */
  sub: string | null;
}

/**
 * The price block for one plan and cycle.
 *   monthly: ~~$99/mo~~ $49/mo, "$490/yr"
 *   annual:  ~~$1,188/yr~~ $490/yr, "$40.83/mo billed yearly"
 * The strike is omitted when the plan has no compare-at price, and also when
 * it would not be higher than the real price: a crossed-out figure that is not
 * a saving claims a discount that is not there.
 */
export function priceLines(plan: ComparisonPlan, cycle: BillingCycle): PriceLines {
  const strikeCents = compareAt({ compare_at_monthly_cents: plan.compareAtMonthlyCents }, cycle);
  if (cycle === "annual") {
    const priceCents = Math.round(plan.annualPrice * 100);
    return {
      strike: strikeCents != null && strikeCents > priceCents ? `${formatCents(strikeCents)}/yr` : null,
      price: `${formatDollars(plan.annualPrice)}/yr`,
      sub:
        plan.annualPrice > 0
          ? `${formatDollars(monthlyEquivalent(plan.annualPrice))}/mo billed yearly`
          : null,
    };
  }
  const priceCents = Math.round(plan.monthlyPrice * 100);
  return {
    strike: strikeCents != null && strikeCents > priceCents ? `${formatCents(strikeCents)}/mo` : null,
    price: `${formatDollars(plan.monthlyPrice)}/mo`,
    sub: plan.annualPrice > 0 ? `${formatDollars(plan.annualPrice)}/yr` : null,
  };
}

/** A section total as displayed: included is per month, bonuses are one-time. */
export function totalLabel(section: PricingSection, cents: number): string {
  return section === "included" ? `${formatCents(cents)}/mo` : formatCents(cents);
}

export function planSectionTotal(section: PricingTableSection, planId: string): string {
  return totalLabel(section.section, sectionTotal(section, planId));
}

export type Accent = "cyan" | "lime";

/** Display index 0 cyan, 1 lime, then alternating. */
export function accentFor(index: number): Accent {
  return Math.abs(index) % 2 === 0 ? "cyan" : "lime";
}

export function isPurchasable(plan: ComparisonPlan, cycle: BillingCycle): boolean {
  return cycle === "annual" ? plan.purchasableAnnual : plan.purchasableMonthly;
}

export function cycleWord(cycle: BillingCycle): "yearly" | "monthly" {
  return cycle === "annual" ? "yearly" : "monthly";
}

/** "Get the STARTER plan", or "Not available yearly" when it cannot be bought. */
export function buttonLabel(plan: ComparisonPlan, cycle: BillingCycle): string {
  return isPurchasable(plan, cycle)
    ? `Get the ${plan.name.toUpperCase()} plan`
    : `Not available ${cycleWord(cycle)}`;
}

export interface CellView {
  kind: "included" | "excluded" | "value";
  /** The figure for "value" cells, else null. */
  text: string | null;
  /** Screen-reader text, naming the row so a lone tick is not ambiguous. */
  srText: string;
}

export function cellView(cell: PricingCell | undefined, rowLabel: string): CellView {
  if (!cell || cell.state === "excluded") {
    return { kind: "excluded", text: null, srText: `${rowLabel}: Not included` };
  }
  if (cell.state === "value" && cell.valueCents != null) {
    const text = formatCents(cell.valueCents);
    return { kind: "value", text, srText: `${rowLabel}: Included, ${text}` };
  }
  return { kind: "included", text: null, srText: `${rowLabel}: Included` };
}

/** "$497 Value" for a row's figure, or null when it has none. */
export function rowValueLabel(valueCents: number | null): string | null {
  return valueCents == null ? null : `${formatCents(valueCents)} Value`;
}

/** The first plan's price label ("Founding Price"), used once for the price row. */
export function sharedPriceLabel(plans: readonly Pick<ComparisonPlan, "priceLabel">[]): string | null {
  return plans.find((p) => p.priceLabel)?.priceLabel ?? null;
}
