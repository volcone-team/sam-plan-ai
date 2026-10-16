import { describe, it, expect } from "vitest";
import { summariseResultsTab, pickMoneyFormatter } from "./results-tab-totals";
import { formatMoney, formatMoneyPrecise } from "./format-money";

/**
 * Results tab totals (Unit A, decision D1).
 *
 * **Validates: Requirements 2.4, 2.5, 2.6**
 */

/** Deterministic PRNG (mulberry32) so failures reproduce from the seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix of whole dollars, 2-dp amounts, sub-cent floats, zero and large values. */
function genAmount(r: () => number): number {
  const kind = Math.floor(r() * 5);
  switch (kind) {
    case 0:
      return Math.floor(r() * 100_000);
    case 1:
      return Math.floor(r() * 10_000_000) / 100;
    case 2:
      return r() * 5_000;
    case 3:
      return 0;
    default:
      return Math.floor(r() * 1_000_000_000) / 100;
  }
}

/** The reader's sum: each row as displayed at 2-dp, added up. */
function displayedSum(values: number[]): number {
  return values.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
}

describe("summariseResultsTab", () => {
  it("sums revenue and expenses in cents, without float drift", () => {
    const s = summariseResultsTab(
      [{ actualRevenue: 0.1 }, { actualRevenue: 0.2 }],
      [{ amount: 0.1 }, { amount: 0.2 }, { amount: 1200.05 }]
    );
    expect(s.totalRevenue).toBe(0.3);
    expect(s.totalExpenses).toBe(1200.35);
  });

  it("returns zeros for an empty tab", () => {
    expect(summariseResultsTab([], [])).toEqual({
      totalRevenue: 0,
      totalExpenses: 0,
      legacySpend: 0,
      hasLegacySpend: false,
    });
  });

  it("treats non-finite values as 0", () => {
    const s = summariseResultsTab(
      [
        { actualRevenue: NaN, actualSpend: Infinity },
        { actualRevenue: 500, actualSpend: NaN },
      ],
      [{ amount: -Infinity }, { amount: 250 }]
    );
    expect(s.totalRevenue).toBe(500);
    expect(s.totalExpenses).toBe(250);
    expect(s.legacySpend).toBe(0);
    expect(s.hasLegacySpend).toBe(false);
  });

  it("reports legacy spend separately and never adds it to a total (D1)", () => {
    const s = summariseResultsTab(
      [
        { actualRevenue: 1000, actualSpend: 300 },
        { actualRevenue: 200 },
        { actualRevenue: 0, actualSpend: null },
      ],
      [{ amount: 450 }]
    );
    expect(s.totalRevenue).toBe(1200);
    expect(s.totalExpenses).toBe(450);
    expect(s.legacySpend).toBe(300);
    expect(s.hasLegacySpend).toBe(true);
  });

  it("property: totals equal the sum of rows at 2-dp for any mix of amounts", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const results = Array.from({ length: Math.floor(r() * 40) }, () => ({
        actualRevenue: genAmount(r),
        actualSpend: r() < 0.3 ? genAmount(r) : undefined,
      }));
      const expenses = Array.from({ length: Math.floor(r() * 40) }, () => ({
        amount: genAmount(r),
      }));

      const s = summariseResultsTab(results, expenses);
      const legacy = displayedSum(results.map((x) => x.actualSpend ?? 0));

      expect(s.totalRevenue, `seed ${seed}`).toBe(displayedSum(results.map((x) => x.actualRevenue)));
      expect(s.totalExpenses, `seed ${seed}`).toBe(displayedSum(expenses.map((x) => x.amount)));
      expect(s.legacySpend, `seed ${seed}`).toBe(legacy);
      expect(s.hasLegacySpend, `seed ${seed}`).toBe(legacy > 0);
      // Totals are always representable at 2-dp.
      expect(Math.round(s.totalRevenue * 100) / 100, `seed ${seed}`).toBe(s.totalRevenue);
      expect(Math.round(s.totalExpenses * 100) / 100, `seed ${seed}`).toBe(s.totalExpenses);
    }
  });
});

describe("pickMoneyFormatter", () => {
  it("uses whole-dollar formatting when every amount is whole", () => {
    const fmt = pickMoneyFormatter([12500, 0, 300]);
    expect(fmt).toBe(formatMoney);
    expect(fmt(12500)).toBe("$12,500");
  });

  it("uses cents when any amount has cents", () => {
    const fmt = pickMoneyFormatter([12500, 0.5]);
    expect(fmt).toBe(formatMoneyPrecise);
    expect(fmt(12500)).toBe("$12,500.00");
  });

  it("treats an empty list and non-finite values as whole", () => {
    expect(pickMoneyFormatter([])).toBe(formatMoney);
    expect(pickMoneyFormatter([NaN, null, undefined, 10])).toBe(formatMoney);
  });

  it("property: a section's total and rows share one precision, with separators", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const amounts = Array.from({ length: 1 + Math.floor(r() * 20) }, () => genAmount(r));
      const total = summariseResultsTab([], amounts.map((amount) => ({ amount }))).totalExpenses;
      const fmt = pickMoneyFormatter([...amounts, total]);
      const anyCents = amounts.some((a) => Math.round(a * 100) % 100 !== 0);

      expect(fmt, `seed ${seed}`).toBe(anyCents ? formatMoneyPrecise : formatMoney);
      for (const v of [...amounts, total]) {
        if (Math.abs(v) >= 1000) expect(fmt(v), `seed ${seed}`).toContain(",");
      }
    }
  });
});
