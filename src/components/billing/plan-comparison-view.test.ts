import { describe, expect, it } from "vitest";
import {
  buildPricingTable,
  type PricingCellRecord,
  type PricingPlanRecord,
  type PricingRowRecord,
} from "@/lib/billing/pricing-table";
import {
  accentFor,
  buttonLabel,
  cellView,
  formatDollars,
  monthlyEquivalent,
  planSectionTotal,
  priceLines,
  rowValueLabel,
  selectComparisonPlans,
  sharedPriceLabel,
  type ComparisonPlan,
} from "./plan-comparison-view";

/* The migration 050 seed, as in src/lib/billing/pricing-table.test.ts. */
const PLANS: PricingPlanRecord[] = [
  { id: "pro", name: "Pro", monthly_price: 149, annual_price: 1490, compare_at_monthly_cents: 19900, price_label: "Founding Price", display_order: 5 },
  { id: "starter", name: "Starter", monthly_price: 49, annual_price: 490, compare_at_monthly_cents: 9900, price_label: "Founding Price", display_order: 4 },
];
type SeedRow = [PricingRowRecord["section"], string, number | null, number, [boolean, number | null], [boolean, number | null]];
const SEED: SeedRow[] = [
  ["included", "Full SAM Plan App", null, 10, [true, 30000], [true, 50000]],
  ["included", "In-app training library", 49700, 20, [true, null], [true, null]],
  ["included", "Live Support by email and chat", 9700, 30, [true, null], [true, null]],
  ["included", "2 extra team seats", 19800, 40, [false, null], [true, null]],
  ["bonus", "1:1 Onboarding Call", 50000, 10, [true, null], [true, null]],
  ["bonus", "ROS meeting agenda", 99700, 20, [true, null], [true, null]],
  ["bonus", "Weekly live ROS meeting with Pete, Rachel & the team (12 months)", 1200000, 30, [false, null], [true, null]],
  ["bonus", "Monthly best practices training with a subject matter expert (12 months)", 596400, 40, [false, null], [true, null]],
];
const ROWS: PricingRowRecord[] = SEED.map(([section, label, value, order], i) => ({
  id: `r${i + 1}`,
  section,
  label,
  sublabel: null,
  value_cents: value,
  display_order: order,
  is_active: true,
}));
const CELLS: PricingCellRecord[] = SEED.flatMap(([, , , , [sInc, sVal], [pInc, pVal]], i) => [
  { row_id: `r${i + 1}`, plan_id: "starter", included: sInc, value_cents: sVal },
  { row_id: `r${i + 1}`, plan_id: "pro", included: pInc, value_cents: pVal },
]);
const TABLE = buildPricingTable(ROWS, CELLS, PLANS);

const offered = (id: string, monthly: number, annual: number, m = true, a = true) => ({
  id,
  monthlyPrice: monthly,
  annualPrice: annual,
  purchasableMonthly: m,
  purchasableAnnual: a,
});

const [STARTER, PRO] = selectComparisonPlans(TABLE, [
  offered("pro", 149, 1490),
  offered("starter", 49, 490),
]);

describe("selectComparisonPlans", () => {
  it("keeps table order and merges table extras with page prices", () => {
    expect([STARTER.id, PRO.id]).toEqual(["starter", "pro"]);
    expect(STARTER.compareAtMonthlyCents).toBe(9900);
    expect(STARTER.priceLabel).toBe("Founding Price");
  });

  it("drops plans missing from either list", () => {
    const out = selectComparisonPlans(TABLE, [offered("pro", 149, 1490), offered("ghost", 1, 10)]);
    expect(out.map((p) => p.id)).toEqual(["pro"]);
    expect(selectComparisonPlans(TABLE, [])).toEqual([]);
  });
});

describe("priceLines on the seed", () => {
  it("Starter monthly: ~~$99/mo~~ $49/mo, $490/yr", () => {
    expect(priceLines(STARTER, "monthly")).toEqual({ strike: "$99/mo", price: "$49/mo", sub: "$490/yr" });
  });

  it("Starter yearly: ~~$1,188/yr~~ $490/yr, $40.83/mo billed yearly", () => {
    expect(priceLines(STARTER, "annual")).toEqual({
      strike: "$1,188/yr",
      price: "$490/yr",
      sub: "$40.83/mo billed yearly",
    });
  });

  it("Pro: ~~$199/mo~~ $149/mo and ~~$2,388/yr~~ $1,490/yr", () => {
    expect(priceLines(PRO, "monthly").strike).toBe("$199/mo");
    expect(priceLines(PRO, "annual")).toMatchObject({ strike: "$2,388/yr", price: "$1,490/yr" });
  });

  it("omits the strike with no compare-at, or when it is not a saving", () => {
    const plain: ComparisonPlan = { ...STARTER, compareAtMonthlyCents: null };
    expect(priceLines(plain, "monthly").strike).toBeNull();
    expect(priceLines(plain, "annual").strike).toBeNull();
    const notCheaper: ComparisonPlan = { ...STARTER, compareAtMonthlyCents: 4900 };
    expect(priceLines(notCheaper, "monthly").strike).toBeNull();
  });

  it("omits the sub line when there is no annual price", () => {
    const monthlyOnly: ComparisonPlan = { ...STARTER, annualPrice: 0 };
    expect(priceLines(monthlyOnly, "monthly").sub).toBeNull();
    expect(priceLines(monthlyOnly, "annual").sub).toBeNull();
  });
});

describe("totals on the seed", () => {
  const [included, bonus] = TABLE.sections;
  it("monthly value per plan", () => {
    expect(planSectionTotal(included, "starter")).toBe("$894/mo");
    expect(planSectionTotal(included, "pro")).toBe("$1,292/mo");
  });
  it("one-time bonuses per plan, no /mo", () => {
    expect(planSectionTotal(bonus, "starter")).toBe("$1,497");
    expect(planSectionTotal(bonus, "pro")).toBe("$19,461");
  });
});

describe("small formatters", () => {
  it("monthlyEquivalent rounds to the cent", () => {
    expect(monthlyEquivalent(490)).toBe(40.83);
    expect(monthlyEquivalent(1200)).toBe(100);
    expect(monthlyEquivalent(1490)).toBe(124.17);
  });

  it("formatDollars shows cents only when fractional", () => {
    expect(formatDollars(1188)).toBe("$1,188");
    expect(formatDollars(40.83)).toBe("$40.83");
    expect(formatDollars(49.5)).toBe("$49.50");
  });

  it("accent alternates cyan, lime", () => {
    expect([0, 1, 2, 3].map(accentFor)).toEqual(["cyan", "lime", "cyan", "lime"]);
  });

  it("button label names the plan, or the unavailable cycle", () => {
    expect(buttonLabel(STARTER, "monthly")).toBe("Get the STARTER plan");
    const noYear: ComparisonPlan = { ...PRO, purchasableAnnual: false };
    expect(buttonLabel(noYear, "annual")).toBe("Not available yearly");
    expect(buttonLabel({ ...PRO, purchasableMonthly: false }, "monthly")).toBe("Not available monthly");
  });

  it("cellView maps states with row-named screen-reader text", () => {
    const [included] = TABLE.sections;
    const app = included.rows[0];
    expect(cellView(app.cells.starter, app.label)).toEqual({
      kind: "value",
      text: "$300",
      srText: "Full SAM Plan App: Included, $300",
    });
    const seats = included.rows[3];
    expect(cellView(seats.cells.starter, seats.label).kind).toBe("excluded");
    expect(cellView(seats.cells.pro, seats.label)).toMatchObject({ kind: "included", text: null });
    expect(cellView(undefined, "X").srText).toBe("X: Not included");
  });

  it("rowValueLabel and sharedPriceLabel", () => {
    expect(rowValueLabel(49700)).toBe("$497 Value");
    expect(rowValueLabel(null)).toBeNull();
    expect(sharedPriceLabel([{ priceLabel: null }, { priceLabel: "Founding Price" }])).toBe("Founding Price");
    expect(sharedPriceLabel([])).toBeNull();
  });
});
