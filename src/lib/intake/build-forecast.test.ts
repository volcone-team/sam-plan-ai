import { describe, it, expect } from "vitest";
import {
  toCadence,
  toFrequency,
  toFunnelStages,
  forecastForStoredInitiative,
  initiativeKindForCadence,
  scenariosFor,
  planTargets,
  GOOD_MULTIPLIER,
  BEST_MULTIPLIER,
} from "./build-forecast";
import { CADENCE_OPTIONS } from "./schema";

/**
 * A row shaped like `intake_initiatives` after a real save: the webinar from
 * the account that surfaced the all-zeros dashboard.
 *
 *   2000 audience -> 50% signed up -> 45% showed -> 12% bought, at $121
 *   = 2000 * .5 * .45 * .12 = 54 buyers * 121 = $6,534 per run
 */
const webinar: Record<string, unknown> = {
  audience_reached: 2000,
  average_price: 121,
  cadence: "once",
  repeat_frequency: null,
  funnel_stages: [
    { key: "signed_up", label: "% who signed up", percent: 50 },
    { key: "showed", label: "% who showed up", percent: 45 },
    { key: "bought", label: "% who bought", percent: 12 },
  ],
};

describe("toCadence", () => {
  it("translates the stored underscore form the constraint uses", () => {
    // The actual bug: 'always_on' fell through to 'once', counting an
    // evergreen initiative a single time instead of monthly.
    expect(toCadence("always_on")).toBe("always-on");
  });

  it("accepts the hyphenated form too, so either source works", () => {
    expect(toCadence("always-on")).toBe("always-on");
  });

  it("passes through once and repeat", () => {
    expect(toCadence("once")).toBe("once");
    expect(toCadence("repeat")).toBe("repeat");
  });

  it("treats an unanswered cadence as a single run, never as evergreen", () => {
    // Crediting a skipped question with 12 runs would inflate the plan.
    expect(toCadence(null)).toBe("once");
    expect(toCadence(undefined)).toBe("once");
    expect(toCadence("nonsense")).toBe("once");
  });

  it("maps every cadence the intake actually offers", () => {
    for (const option of CADENCE_OPTIONS) {
      expect(["once", "repeat", "always-on"]).toContain(toCadence(option.value));
    }
  });
});

describe("toFrequency", () => {
  it("passes through the three real frequencies", () => {
    expect(toFrequency("weekly")).toBe("weekly");
    expect(toFrequency("monthly")).toBe("monthly");
    expect(toFrequency("quarterly")).toBe("quarterly");
  });

  it("is null when absent, which Once and Always on both are", () => {
    expect(toFrequency(null)).toBeNull();
    expect(toFrequency("yearly")).toBeNull();
  });
});

describe("toFunnelStages", () => {
  it("reads stored stages back with their percentages", () => {
    const stages = toFunnelStages(webinar.funnel_stages);

    expect(stages).toHaveLength(3);
    expect(stages[0]).toEqual({
      key: "signed_up",
      label: "% who signed up",
      percent: 50,
    });
  });

  it("keeps a skipped percentage as null rather than zero", () => {
    // forecastPerRun relies on this to withhold a forecast instead of
    // reporting a confident $0.
    const stages = toFunnelStages([{ key: "a", label: "A", percent: null }]);
    expect(stages[0].percent).toBeNull();
  });

  it("falls back to the key when no label was stored", () => {
    expect(toFunnelStages([{ key: "bought", percent: 10 }])[0].label).toBe("bought");
  });

  it("yields no stages for malformed data instead of throwing", () => {
    expect(toFunnelStages(null)).toEqual([]);
    expect(toFunnelStages("[]")).toEqual([]);
    expect(toFunnelStages([null, 5, {}, { label: "no key" }])).toEqual([]);
  });
});

describe("forecastForStoredInitiative", () => {
  it("reproduces the per-run figure the recommendations screen showed", () => {
    expect(forecastForStoredInitiative(webinar, 3)).toBe(6534);
  });

  it("counts a repeating initiative once per month", () => {
    const monthly = { ...webinar, cadence: "repeat", repeat_frequency: "monthly" };
    expect(forecastForStoredInitiative(monthly, 3)).toBe(6534 * 3);
  });

  it("counts always_on monthly, which is the bug this guards", () => {
    const evergreen = { ...webinar, cadence: "always_on" };
    // Would have been 6534 before the cadence translation.
    expect(forecastForStoredInitiative(evergreen, 12)).toBe(6534 * 12);
  });

  it("has no forecast when a funnel stage was skipped", () => {
    const partial = {
      ...webinar,
      funnel_stages: [
        { key: "signed_up", label: "A", percent: 50 },
        { key: "bought", label: "B", percent: null },
      ],
    };
    expect(forecastForStoredInitiative(partial, 12)).toBeNull();
  });

  it("has no forecast with no price, rather than reporting zero", () => {
    expect(forecastForStoredInitiative({ ...webinar, average_price: null }, 12)).toBeNull();
  });
});

describe("scenariosFor", () => {
  it("uses the forecast itself as the better case", () => {
    // "Better assumes they land as planned" — the user's own funnel figures.
    expect(scenariosFor(10000).better).toBe(10000);
  });

  it("brackets it at the same spread the generator uses", () => {
    const s = scenariosFor(10000);
    expect(s.good).toBe(10000 * GOOD_MULTIPLIER);
    expect(s.best).toBe(10000 * BEST_MULTIPLIER);
  });

  it("keeps good below better below best", () => {
    const s = scenariosFor(6534);
    expect(s.good).toBeLessThan(s.better);
    expect(s.better).toBeLessThan(s.best);
  });

  it("is all zeros when there is no forecast", () => {
    // The column is NOT NULL, so an absent forecast has to store something.
    expect(scenariosFor(null)).toEqual({ good: 0, better: 0, best: 0 });
    expect(scenariosFor(0)).toEqual({ good: 0, better: 0, best: 0 });
  });

  it("rounds to whole currency", () => {
    for (const value of Object.values(scenariosFor(6534.77))) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe("planTargets", () => {
  it("uses the user's stated goal as the baseline", () => {
    // NOT the forecast: overwriting the goal would hide the gap.
    expect(planTargets(1234456).baseline).toBe(1234456);
  });

  it("sets stretch above baseline", () => {
    const { baseline, stretch } = planTargets(100000);
    expect(stretch).toBeGreaterThan(baseline);
  });

  it("is zero when no goal was given", () => {
    expect(planTargets(null)).toEqual({ baseline: 0, stretch: 0 });
    expect(planTargets(0)).toEqual({ baseline: 0, stretch: 0 });
  });
});

describe("initiativeKindForCadence", () => {
  it("maps each intake cadence to the plan's kind", () => {
    expect(initiativeKindForCadence("once")).toBe("one-time");
    expect(initiativeKindForCadence("repeat")).toBe("recurring");
    expect(initiativeKindForCadence("always_on")).toBe("evergreen");
  });

  /**
   * The hyphen/underscore mismatch this module exists to absorb. The intake
   * stores 'always_on' to satisfy its CHECK constraint; the forecast model
   * uses 'always-on'.
   */
  it("accepts the hyphenated spelling too", () => {
    expect(initiativeKindForCadence("always-on")).toBe("evergreen");
  });

  /**
   * ALWAYS-ON IS NOT RECURRING, and the difference is behavioural rather than
   * cosmetic: the weekly planner shows an evergreen initiative for every week
   * after its activation instead of keying off one event date, and
   * generate-plan's scheduler treats it as non-exclusive.
   */
  it("does not collapse always-on into recurring", () => {
    expect(initiativeKindForCadence("always_on")).not.toBe("recurring");
  });

  it("falls back to one-time when the question was skipped", () => {
    for (const value of [null, undefined, "", "nonsense", 7, {}]) {
      expect(initiativeKindForCadence(value)).toBe("one-time");
    }
  });

  it("covers every cadence the intake can store", () => {
    for (const option of CADENCE_OPTIONS) {
      const kind = initiativeKindForCadence(option.value);
      expect(["one-time", "recurring", "evergreen"]).toContain(kind);
    }
  });

  /**
   * THE CONTRADICTION THIS CLOSES.
   *
   * The revenue written to an initiative is already multiplied by the number
   * of runs its cadence implies, so a repeating initiative stored as
   * 'one-time' claimed many runs' revenue for a single dated event. Asserted
   * together so neither half can be changed without the other being seen to
   * disagree.
   */
  it("marks an initiative recurring exactly when its forecast assumes repetition", () => {
    const monthly = { ...webinar, cadence: "repeat", repeat_frequency: "monthly" };
    const once = { ...webinar, cadence: "once", repeat_frequency: null };

    const monthlyRevenue = forecastForStoredInitiative(monthly, 12)!;
    const onceRevenue = forecastForStoredInitiative(once, 12)!;

    // The forecast really does scale with the cadence.
    expect(monthlyRevenue).toBeGreaterThan(onceRevenue);
    // ...and the stored kind now says so.
    expect(initiativeKindForCadence(monthly.cadence)).toBe("recurring");
    expect(initiativeKindForCadence(once.cadence)).toBe("one-time");
  });
});
