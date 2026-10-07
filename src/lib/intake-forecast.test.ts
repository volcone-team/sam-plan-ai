import { describe, it, expect } from "vitest";
import {
  productGoal,
  productsTotal,
  suggestedStretch,
  impliedGrowthPercent,
  assessGoal,
  proratedPriorRevenue,
  proratedStretch,
  assessGoalForPeriod,
  funnelSteps,
  forecastPerRun,
  runsInPeriod,
  forecastForInitiative,
  goalGap,
  type InitiativeFunnel,
} from "./intake-forecast";

/**
 * Pinned to the MOCKUP'S OWN NUMBERS wherever it shows one, so the maths is
 * verified against the intended design rather than against my reading of it.
 * These figures are shown to the customer as their revenue plan and then drive
 * what the AI recommends, so a quiet slip produces a plausible plan built on a
 * wrong target.
 */

describe("productGoal", () => {
  // Screen 3: $5,000 average x 60 units = $300,000 "Product goal".
  it("matches the mockup's product goal", () => {
    expect(productGoal(5000, 60)).toBe(300000);
  });

  it("is zero before both inputs are given", () => {
    expect(productGoal(5000, null)).toBe(0);
    expect(productGoal(null, 60)).toBe(0);
  });

  it("treats negatives as zero rather than subtracting revenue", () => {
    expect(productGoal(-5000, 60)).toBe(0);
    expect(productGoal(5000, -60)).toBe(0);
  });
});

describe("productsTotal", () => {
  // Screen 3: one product, so the total equals its goal.
  it("matches the mockup's products total", () => {
    expect(productsTotal([{ averagePrice: 5000, unitsInPeriod: 60 }])).toBe(300000);
  });

  it("sums several products", () => {
    expect(
      productsTotal([
        { averagePrice: 5000, unitsInPeriod: 60 },
        { averagePrice: 2000, unitsInPeriod: 25 },
      ])
    ).toBe(350000);
  });

  it("is zero with no products", () => {
    expect(productsTotal([])).toBe(0);
  });

  it("ignores incomplete rows instead of producing NaN", () => {
    expect(
      productsTotal([
        { averagePrice: 5000, unitsInPeriod: 60 },
        { averagePrice: null, unitsInPeriod: null },
      ])
    ).toBe(300000);
  });
});

describe("suggestedStretch", () => {
  // Screen 4: $450,000 last 12 months -> "Suggested stretch (+30%) $585,000".
  it("matches the mockup's suggested stretch", () => {
    expect(suggestedStretch(450000)).toBe(585000);
  });

  // A new business has no baseline; suggesting $0 is worse than suggesting nothing.
  it("returns null with no prior revenue", () => {
    expect(suggestedStretch(0)).toBeNull();
    expect(suggestedStretch(null)).toBeNull();
  });
});

describe("impliedGrowthPercent", () => {
  // Screen 4: $750,000 goal against $450,000 -> "a 67% jump".
  it("matches the mockup's stated growth", () => {
    expect(impliedGrowthPercent(750000, 450000)).toBe(67);
  });

  it("reports zero growth for a flat goal", () => {
    expect(impliedGrowthPercent(450000, 450000)).toBe(0);
  });

  it("reports negative growth for a lower goal", () => {
    expect(impliedGrowthPercent(400000, 450000)).toBe(-11);
  });

  it("returns null without a baseline to compare against", () => {
    expect(impliedGrowthPercent(750000, 0)).toBeNull();
  });
});

describe("assessGoal", () => {
  it("warns on the mockup's 67% jump and states the actual figure", () => {
    const a = assessGoal(750000, 450000);
    expect(a.warn).toBe(true);
    expect(a.growthPercent).toBe(67);
    expect(a.message).toContain("67%");
    expect(a.message).toContain("30%");
  });

  // A warning on every slightly ambitious goal is noise users stop reading.
  it("stays quiet on ordinary growth", () => {
    expect(assessGoal(585000, 450000).warn).toBe(false);
    expect(assessGoal(585000, 450000).message).toBeNull();
  });

  it("says nothing when there is no prior revenue", () => {
    expect(assessGoal(750000, null).message).toBeNull();
  });

  // Informing, not blocking: a deliberate stretch target is a valid choice.
  it("never tells the user the goal is not allowed", () => {
    const msg = assessGoal(5000000, 450000).message ?? "";
    expect(msg).toMatch(/keep your number/i);
  });
});

/** Screen 5, Initiative 1: the webinar funnel the mockup forecasts from. */
const WEBINAR: InitiativeFunnel = {
  audienceReached: 3000,
  stages: [
    { key: "registered", label: "% who registered", percent: 12 },
    { key: "showed", label: "% who showed up", percent: 30 },
    { key: "bought", label: "% who bought", percent: 4 },
  ],
  averagePrice: 5000,
};

describe("funnelSteps", () => {
  it("reduces the audience through each stage", () => {
    const steps = funnelSteps(WEBINAR);
    expect(steps.map((s) => Math.round(s.people))).toEqual([360, 108, 4]);
  });

  it("treats a skipped stage as zero rather than skipping it", () => {
    const steps = funnelSteps({
      ...WEBINAR,
      stages: [{ key: "registered", label: "r", percent: null }],
    });
    expect(steps[0].people).toBe(0);
  });
});

describe("forecastPerRun", () => {
  // 3,000 x 12% x 30% x 4% = 4.32 buyers x $5,000 = $21,600 per run.
  it("matches the mockup's per-run figure", () => {
    expect(forecastPerRun(WEBINAR)).toBeCloseTo(21600, 2);
  });

  /**
   * Null, not zero. A forecast of zero and an absent forecast mean very
   * different things to someone deciding whether to run a campaign, and the
   * mockup shows "Based on industry averages" for the absent case.
   */
  it("returns null when a stage was skipped", () => {
    expect(
      forecastPerRun({
        ...WEBINAR,
        stages: [...WEBINAR.stages.slice(0, 2), { key: "bought", label: "b", percent: null }],
      })
    ).toBeNull();
  });

  it("returns null without an audience", () => {
    expect(forecastPerRun({ ...WEBINAR, audienceReached: null })).toBeNull();
  });

  it("returns null without a price", () => {
    expect(forecastPerRun({ ...WEBINAR, averagePrice: null })).toBeNull();
  });
});

describe("runsInPeriod", () => {
  it("counts a one-off as a single run", () => {
    expect(runsInPeriod("once", null, 12)).toBe(1);
  });

  // The mockup's webinar: monthly over 12 months.
  it("counts monthly repeats across the horizon", () => {
    expect(runsInPeriod("repeat", "monthly", 12)).toBe(12);
  });

  it("counts quarterly repeats", () => {
    expect(runsInPeriod("repeat", "quarterly", 12)).toBe(4);
  });

  it("counts weekly repeats without over-counting partial weeks", () => {
    expect(runsInPeriod("repeat", "weekly", 12)).toBe(52);
  });

  // Treating evergreen as one run would understate it twelvefold.
  it("treats always-on as monthly", () => {
    expect(runsInPeriod("always-on", null, 12)).toBe(12);
  });

  it("scales to a shorter horizon", () => {
    expect(runsInPeriod("repeat", "monthly", 6)).toBe(6);
    expect(runsInPeriod("repeat", "quarterly", 6)).toBe(2);
  });
});

describe("forecastForInitiative", () => {
  // Screen 10 shows the Live Webinar forecast as $259,200.
  it("matches the mockup's Live Webinar forecast exactly", () => {
    const total = forecastForInitiative({
      funnel: WEBINAR,
      cadence: "repeat",
      frequency: "monthly",
      horizonMonths: 12,
    });
    expect(total).toBeCloseTo(259200, 2);
  });

  it("forecasts a one-off as a single run", () => {
    const total = forecastForInitiative({
      funnel: WEBINAR,
      cadence: "once",
      frequency: null,
      horizonMonths: 12,
    });
    expect(total).toBeCloseTo(21600, 2);
  });

  it("stays null when the funnel is incomplete, whatever the cadence", () => {
    expect(
      forecastForInitiative({
        funnel: { ...WEBINAR, audienceReached: null },
        cadence: "repeat",
        frequency: "monthly",
        horizonMonths: 12,
      })
    ).toBeNull();
  });
});

describe("goalGap", () => {
  /**
   * Screen 10: yours $458,600 + recommended $160,000 against a $750,000 goal,
   * leaving the "Gap to goal: $131,400" the mockup states.
   */
  it("matches the mockup's gap to goal", () => {
    const g = goalGap({ goal: 750000, yours: [259200, 199400], recommended: [96000, 64000] });
    expect(g.yoursTotal).toBe(458600);
    expect(g.recommendedTotal).toBe(160000);
    expect(g.plannedTotal).toBe(618600);
    expect(g.gap).toBe(131400);
    expect(g.covered).toBe(false);
  });

  it("reports a surplus once the goal is covered", () => {
    const g = goalGap({ goal: 500000, yours: [400000], recommended: [200000] });
    expect(g.covered).toBe(true);
    expect(g.gap).toBe(0);
    expect(g.surplus).toBe(100000);
  });

  // The copy says the bar updates as recommendations are accepted or dismissed.
  it("drops the recommended segment when recommendations are dismissed", () => {
    const g = goalGap({ goal: 750000, yours: [458600], recommended: [] });
    expect(g.recommendedTotal).toBe(0);
    expect(g.gap).toBe(291400);
  });

  it("ignores unforecast initiatives rather than counting them as zero revenue", () => {
    const g = goalGap({ goal: 100000, yours: [50000, null], recommended: [null] });
    expect(g.yoursTotal).toBe(50000);
    expect(g.plannedTotal).toBe(50000);
  });

  it("caps the bar at 100% when the goal is beaten", () => {
    expect(goalGap({ goal: 100000, yours: [500000], recommended: [] }).percent).toBe(100);
  });

  // Two segments drawn on one bar must never total more than its width.
  it("keeps the two bar segments within 100% combined", () => {
    const g = goalGap({ goal: 100000, yours: [80000], recommended: [80000] });
    expect(g.yoursPercent + g.recommendedPercent).toBeLessThanOrEqual(100.0001);
  });

  it("handles no goal set without dividing by zero", () => {
    const g = goalGap({ goal: 0, yours: [1000], recommended: [] });
    expect(g.percent).toBe(0);
    expect(g.gap).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Proration (REQ-7.2)
 * ------------------------------------------------------------------ */

describe("proratedPriorRevenue", () => {
  /**
   * The figure the requirement calls out explicitly. Showing the unprorated
   * $450,000 on a 6-month plan invites a goal roughly double what the user
   * means, and nothing downstream would flag it — an ambitious goal is
   * legitimate.
   */
  it("scales $450,000 to $225,000 over 6 months", () => {
    expect(proratedPriorRevenue(450_000, 6)).toBe(225_000);
  });

  it("leaves a 12-month period unchanged", () => {
    expect(proratedPriorRevenue(450_000, 12)).toBe(450_000);
  });

  it("scales up for an 18-month period", () => {
    expect(proratedPriorRevenue(450_000, 18)).toBe(675_000);
  });

  it("handles a quarter", () => {
    expect(proratedPriorRevenue(450_000, 3)).toBe(112_500);
  });

  // A brand-new business has no baseline; "$0" would read as a measurement.
  it("returns null with no prior revenue", () => {
    expect(proratedPriorRevenue(0, 12)).toBeNull();
    expect(proratedPriorRevenue(null, 12)).toBeNull();
    expect(proratedPriorRevenue(undefined, 6)).toBeNull();
  });

  it("returns null without a period", () => {
    expect(proratedPriorRevenue(450_000, null)).toBeNull();
    expect(proratedPriorRevenue(450_000, 0)).toBeNull();
  });

  it("rounds to whole dollars", () => {
    expect(Number.isInteger(proratedPriorRevenue(100_000, 7))).toBe(true);
  });
});

describe("proratedStretch", () => {
  // The requirement's worked example: $225,000 prorated, $292,500 stretch.
  it("matches the requirement's 6-month stretch", () => {
    expect(proratedStretch(450_000, 6)).toBe(292_500);
  });

  it("is 1.3x the prorated figure", () => {
    const prorated = proratedPriorRevenue(450_000, 12)!;
    expect(proratedStretch(450_000, 12)).toBe(Math.round(prorated * 1.3));
  });

  it("returns null when there is no baseline to stretch from", () => {
    expect(proratedStretch(0, 12)).toBeNull();
    expect(proratedStretch(null, 6)).toBeNull();
  });
});

describe("assessGoalForPeriod", () => {
  /**
   * The threshold has to be measured against the PRORATED baseline. Comparing a
   * 6-month goal to the annual figure gets both cases backwards: a sensible
   * $225,000 looks like a 50% shortfall, and a genuine stretch looks modest.
   */
  it("does not warn on a goal matching the prorated baseline", () => {
    const assessment = assessGoalForPeriod(225_000, 450_000, 6);
    expect(assessment.warn).toBe(false);
    expect(assessment.growthPercent).toBe(0);
  });

  it("warns on a 6-month goal well above the prorated baseline", () => {
    const assessment = assessGoalForPeriod(450_000, 450_000, 6);
    // $450,000 against a $225,000 prorated baseline is a 100% jump.
    expect(assessment.growthPercent).toBe(100);
    expect(assessment.warn).toBe(true);
    expect(assessment.message).toContain("100%");
  });

  it("does not warn on the suggested stretch itself", () => {
    const stretch = proratedStretch(450_000, 6)!;
    expect(assessGoalForPeriod(stretch, 450_000, 6).warn).toBe(false);
  });

  it("says nothing without a baseline", () => {
    const assessment = assessGoalForPeriod(100_000, null, 12);
    expect(assessment.message).toBeNull();
    expect(assessment.warn).toBe(false);
  });

  it("agrees with assessGoal on a 12-month plan", () => {
    expect(assessGoalForPeriod(750_000, 450_000, 12)).toEqual(
      assessGoal(750_000, 450_000)
    );
  });
});
