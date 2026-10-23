import { describe, it, expect } from "vitest";
import {
  buildPricingTable,
  sectionTotal,
  compareAt,
  cellFor,
  cellInputToRecord,
  dollarsToCents,
  centsToDollarsInput,
  reorderAfterMove,
  validatePricingRowInput,
  validatePricingCellInput,
  validatePlanExtrasInput,
  validateAnnualNoteInput,
  type PricingCellRecord,
  type PricingPlanRecord,
  type PricingRowRecord,
} from "./pricing-table";

/* The migration 050 seed (scripts/gen-migration-050.mjs), in cents. */
const STARTER = "starter";
const PRO = "pro";
const PLANS: PricingPlanRecord[] = [
  { id: PRO, name: "Pro", monthly_price: 149, annual_price: 1490, compare_at_monthly_cents: 19900, price_label: "Founding Price", display_order: 5 },
  { id: STARTER, name: "Starter", monthly_price: 49, annual_price: 490, compare_at_monthly_cents: 9900, price_label: "Founding Price", display_order: 4 },
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
  { row_id: `r${i + 1}`, plan_id: STARTER, included: sInc, value_cents: sVal },
  { row_id: `r${i + 1}`, plan_id: PRO, included: pInc, value_cents: pVal },
]);

describe("buildPricingTable + sectionTotal on the 050 seed", () => {
  const table = buildPricingTable(ROWS, CELLS, PLANS);
  const [included, bonus] = table.sections;

  it("gives the exact seeded column totals", () => {
    expect(sectionTotal(included, STARTER)).toBe(89400);
    expect(sectionTotal(included, PRO)).toBe(129200);
    expect(sectionTotal(bonus, STARTER)).toBe(149700);
    expect(sectionTotal(bonus, PRO)).toBe(1946100);
  });

  it("orders sections, rows and plans", () => {
    expect(table.sections.map((s) => s.section)).toEqual(["included", "bonus"]);
    expect(included.rows.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(table.plans.map((p) => p.id)).toEqual([STARTER, PRO]);
  });

  it("derives cell states", () => {
    expect(included.rows[0].cells[STARTER]).toEqual({ state: "value", valueCents: 30000 });
    expect(included.rows[1].cells[PRO]).toEqual({ state: "included", valueCents: null });
    expect(included.rows[3].cells[STARTER]).toEqual({ state: "excluded", valueCents: null });
  });

  it("drops inactive rows and treats a missing cell as excluded", () => {
    const rows = ROWS.map((r) => (r.id === "r2" ? { ...r, is_active: false } : r));
    const cells = CELLS.filter((c) => !(c.row_id === "r3" && c.plan_id === STARTER));
    const t = buildPricingTable(rows, cells, PLANS);
    expect(t.sections[0].rows.map((r) => r.id)).toEqual(["r1", "r3", "r4"]);
    expect(t.sections[0].rows[1].cells[STARTER].state).toBe("excluded");
    expect(sectionTotal(t.sections[0], STARTER)).toBe(30000);
  });

  it("counts 0 for an included row with no figure anywhere", () => {
    const rows: PricingRowRecord[] = [{ ...ROWS[1], value_cents: null }];
    const t = buildPricingTable(rows, CELLS, PLANS);
    expect(sectionTotal(t.sections[0], PRO)).toBe(0);
  });
});

describe("cellFor", () => {
  it("ignores a figure on an excluded cell", () => {
    expect(cellFor({ row_id: "r", plan_id: "p", included: false, value_cents: 500 })).toEqual({
      state: "excluded",
      valueCents: null,
    });
    expect(cellFor(undefined).state).toBe("excluded");
  });
});

describe("compareAt", () => {
  it("monthly is the stored figure, annual is ×12, null stays null", () => {
    expect(compareAt(PLANS[1], "monthly")).toBe(9900);
    expect(compareAt(PLANS[1], "annual")).toBe(118800);
    expect(compareAt(PLANS[0], "annual")).toBe(238800);
    expect(compareAt({ compare_at_monthly_cents: null }, "monthly")).toBeNull();
    expect(compareAt({ compare_at_monthly_cents: null }, "annual")).toBeNull();
  });
});

describe("validatePricingRowInput", () => {
  it("accepts and normalises a valid row", () => {
    expect(
      validatePricingRowInput({ section: "bonus", label: "  Call  ", sublabel: "  ", valueCents: 49700 })
    ).toEqual({
      ok: true,
      value: { section: "bonus", label: "Call", sublabel: null, valueCents: 49700, isActive: true },
    });
    const r = validatePricingRowInput({ section: "included", label: "X", valueCents: "" });
    expect(r.ok && r.value.valueCents).toBe(null);
  });

  it("requires a label of at most 200 characters", () => {
    expect(validatePricingRowInput({ section: "included", label: " " })).toMatchObject({ ok: false, errors: { label: "Required." } });
    expect(validatePricingRowInput({ section: "included", label: "x".repeat(200) }).ok).toBe(true);
    expect(validatePricingRowInput({ section: "included", label: "x".repeat(201) }).ok).toBe(false);
  });

  it("limits the sublabel to 300 characters", () => {
    expect(validatePricingRowInput({ section: "included", label: "x", sublabel: "s".repeat(300) }).ok).toBe(true);
    expect(validatePricingRowInput({ section: "included", label: "x", sublabel: "s".repeat(301) })).toMatchObject({ ok: false, errors: { sublabel: expect.any(String) } });
  });

  it("rejects an unknown section", () => {
    expect(validatePricingRowInput({ section: "extra", label: "x" })).toMatchObject({ ok: false, errors: { section: expect.any(String) } });
    expect(validatePricingRowInput(null)).toMatchObject({ ok: false });
  });

  it("accepts value 0 to 1e10 whole cents only", () => {
    const v = (valueCents: unknown) => validatePricingRowInput({ section: "included", label: "x", valueCents }).ok;
    expect(v(0)).toBe(true);
    expect(v(10_000_000_000)).toBe(true);
    expect(v(10_000_000_001)).toBe(false);
    expect(v(-1)).toBe(false);
    expect(v(1.5)).toBe(false);
    expect(v("abc")).toBe(false);
    expect(v(Number.NaN)).toBe(false);
  });
});

describe("validatePricingCellInput", () => {
  it("requires a figure for state value and drops it otherwise", () => {
    expect(validatePricingCellInput({ rowId: "r", planId: "p", state: "value" }).ok).toBe(false);
    expect(validatePricingCellInput({ rowId: "r", planId: "p", state: "value", valueCents: 30000 })).toEqual({
      ok: true,
      value: { rowId: "r", planId: "p", state: "value", valueCents: 30000 },
    });
    const inc = validatePricingCellInput({ rowId: "r", planId: "p", state: "included", valueCents: 5 });
    expect(inc.ok && inc.value.valueCents).toBe(null);
    expect(validatePricingCellInput({ rowId: "r", planId: "p", state: "maybe" }).ok).toBe(false);
  });

  it("maps to stored columns", () => {
    expect(cellInputToRecord({ rowId: "r", planId: "p", state: "excluded", valueCents: null })).toEqual({ row_id: "r", plan_id: "p", included: false, value_cents: null });
    expect(cellInputToRecord({ rowId: "r", planId: "p", state: "value", valueCents: 500 })).toEqual({ row_id: "r", plan_id: "p", included: true, value_cents: 500 });
  });
});

describe("validatePlanExtrasInput / validateAnnualNoteInput", () => {
  it("only includes fields that were sent, blank clears", () => {
    expect(validatePlanExtrasInput({ planId: "p", priceLabel: " " })).toEqual({ ok: true, value: { planId: "p", priceLabel: null } });
    expect(validatePlanExtrasInput({ planId: "p", compareAtMonthlyCents: 9900 })).toEqual({ ok: true, value: { planId: "p", compareAtMonthlyCents: 9900 } });
    expect(validatePlanExtrasInput({ planId: "p" }).ok).toBe(false);
    expect(validatePlanExtrasInput({ planId: "p", priceLabel: "x".repeat(61) }).ok).toBe(false);
    expect(validatePlanExtrasInput({ planId: "p", compareAtMonthlyCents: -5 }).ok).toBe(false);
  });

  it("validates the annual note", () => {
    expect(validateAnnualNoteInput({ text: " 2 months free ", valueCents: 250000 })).toEqual({ ok: true, value: { text: "2 months free", valueCents: 250000 } });
    expect(validateAnnualNoteInput({ text: "x".repeat(301) }).ok).toBe(false);
    expect(validateAnnualNoteInput({}).ok).toBe(false);
  });
});

describe("dollarsToCents / centsToDollarsInput", () => {
  it("round-trips typical admin input", () => {
    expect(dollarsToCents("497")).toBe(49700);
    expect(dollarsToCents("12,000")).toBe(1200000);
    expect(dollarsToCents("4.5")).toBe(450);
    expect(dollarsToCents("")).toBeNull();
    expect(Number.isNaN(dollarsToCents("abc"))).toBe(true);
    expect(Number.isNaN(dollarsToCents("1.234"))).toBe(true);
    expect(centsToDollarsInput(49700)).toBe("497");
    expect(centsToDollarsInput(450)).toBe("4.50");
    expect(centsToDollarsInput(null)).toBe("");
  });
});

describe("reorderAfterMove", () => {
  it("swaps within the section and renumbers by 10", () => {
    expect(reorderAfterMove(ROWS, "r2", "up")).toEqual([
      { id: "r2", display_order: 10 },
      { id: "r1", display_order: 20 },
      { id: "r3", display_order: 30 },
      { id: "r4", display_order: 40 },
    ]);
    expect(reorderAfterMove(ROWS, "r5", "up")).toBeNull();
    expect(reorderAfterMove(ROWS, "r8", "down")).toBeNull();
    expect(reorderAfterMove(ROWS, "nope", "down")).toBeNull();
  });
});
