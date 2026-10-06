import { describe, it, expect } from "vitest";
import {
  sumInitiatives,
  goalCoverage,
  goalProgress,
  shouldTrackPace,
  trackingStartsLabel,
} from "./plan-totals";

/**
 * The reported bug: six initiatives totalling 135,000 / 210,000 / 293,000 sat
 * directly above a panel claiming 256,000 / 420,000 / 630,000, because the
 * panel read the `projections` table while the cards summed `initiatives`.
 * These lock the totals to the initiatives, so the panel and the list view's
 * totals row agree by construction.
 */

const SIX = [
  { revenueGood: 20000, revenueBetter: 35000, revenueBest: 50000, plannedBudget: 4000 },
  { revenueGood: 10000, revenueBetter: 15000, revenueBest: 25000, plannedBudget: 500 },
  { revenueGood: 12000, revenueBetter: 20000, revenueBest: 30000, plannedBudget: 3000 },
  { revenueGood: 30000, revenueBetter: 50000, revenueBest: 70000, plannedBudget: 2000 },
  { revenueGood: 18000, revenueBetter: 30000, revenueBest: 43000, plannedBudget: 1000 },
  { revenueGood: 45000, revenueBetter: 60000, revenueBest: 75000, plannedBudget: 4000 },
];

describe("sumInitiatives", () => {
  it("totals each scenario across initiatives", () => {
    const t = sumInitiatives(SIX);
    expect(t.good).toBe(135000);
    expect(t.better).toBe(210000);
    expect(t.best).toBe(293000);
  });

  it("counts the initiatives summed, so the UI can show 'X of N'", () => {
    expect(sumInitiatives(SIX).count).toBe(6);
  });

  it("totals budget and spend for the list view's totals row", () => {
    const t = sumInitiatives([
      { revenueGood: 1, revenueBetter: 2, revenueBest: 3, plannedBudget: 500, actualSpend: 200 },
      { revenueGood: 1, revenueBetter: 2, revenueBest: 3, plannedBudget: 300, actualSpend: 100 },
    ]);
    expect(t.plannedBudget).toBe(800);
    expect(t.actualSpend).toBe(300);
  });

  it("returns zeros for an empty plan rather than NaN", () => {
    const t = sumInitiatives([]);
    expect(t).toEqual({ good: 0, better: 0, best: 0, plannedBudget: 0, actualSpend: 0, count: 0 });
  });

  // Postgres NUMERIC comes back as a string through some client paths.
  it("accepts numeric strings", () => {
    const t = sumInitiatives([
      { revenueGood: "100", revenueBetter: "200", revenueBest: "300" },
    ] as never);
    expect(t.better).toBe(200);
  });

  // One bad row must not blank the whole panel.
  it("treats missing and non-finite values as zero", () => {
    const t = sumInitiatives([
      { revenueGood: 100, revenueBetter: 200, revenueBest: 300 },
      { revenueGood: NaN, revenueBetter: undefined, revenueBest: null },
    ] as never);
    expect(t.good).toBe(100);
    expect(t.better).toBe(200);
    expect(t.best).toBe(300);
  });
});

describe("goalCoverage", () => {
  it("reports coverage when the plan clears the goal", () => {
    const c = goalCoverage(210000, 75000);
    expect(c.covers).toBe(true);
    expect(c.shortfall).toBe(0);
    expect(c.surplus).toBe(135000);
  });

  // The actionable number: "falls short" alone tells nobody how much to close.
  it("reports the shortfall when the plan misses the goal", () => {
    const c = goalCoverage(630000, 1000000);
    expect(c.covers).toBe(false);
    expect(c.shortfall).toBe(370000);
    expect(c.surplus).toBe(0);
  });

  it("caps the percentage at 100", () => {
    expect(goalCoverage(500000, 100000).percent).toBe(100);
  });

  it("computes a partial percentage", () => {
    expect(goalCoverage(630000, 1000000).percent).toBe(63);
  });

  it("flags an unset goal instead of claiming coverage", () => {
    const c = goalCoverage(50000, 0);
    expect(c.noGoal).toBe(true);
    expect(c.covers).toBe(false);
  });

  it("treats exactly meeting the goal as covered", () => {
    expect(goalCoverage(75000, 75000).covers).toBe(true);
  });
});

describe("goalProgress", () => {
  it("reports earned and remaining", () => {
    const p = goalProgress(25000, 75000);
    expect(p.earned).toBe(25000);
    expect(p.remaining).toBe(50000);
    expect(p.percent).toBe(33);
  });

  it("shows zero progress on a fresh plan without NaN", () => {
    const p = goalProgress(0, 6060000);
    expect(p.earned).toBe(0);
    expect(p.remaining).toBe(6060000);
    expect(p.percent).toBe(0);
  });

  it("never reports negative remaining once the goal is beaten", () => {
    const p = goalProgress(100000, 75000);
    expect(p.remaining).toBe(0);
    expect(p.reached).toBe(true);
    expect(p.percent).toBe(100);
  });

  it("flags an unset goal", () => {
    expect(goalProgress(1000, 0).noGoal).toBe(true);
  });
});

/**
 * Item 8: the 2027 view reported "0% of pace · behind by 210,000" before the
 * year had started — measuring a company against a period that has not begun.
 */
describe("shouldTrackPace", () => {
  const now = new Date("2026-10-03T12:00:00Z");

  it("does not track a future plan year", () => {
    expect(shouldTrackPace(2027, now)).toBe(false);
  });

  it("tracks the current year", () => {
    expect(shouldTrackPace(2026, now)).toBe(true);
  });

  // A finished year's comparison is complete, which is the point of reviewing it.
  it("tracks a past year", () => {
    expect(shouldTrackPace(2025, now)).toBe(true);
  });
});

describe("trackingStartsLabel", () => {
  it("names the date tracking begins", () => {
    expect(trackingStartsLabel(2027)).toBe("Tracking starts January 1, 2027");
  });
});
