import { describe, it, expect } from "vitest";
import {
  FUNNEL_STAGES,
  FUNNEL_FIELD_COUNT,
  funnelFieldsFor,
  emptyFunnelAnswers,
  toInitiativeFunnel,
  fromStoredStages,
  isFunnelComplete,
  funnelCompletedCount,
  LABEL_OVERRIDES,
  type FunnelAnswers,
} from "./funnel";
import { forecastPerRun } from "@/lib/intake-forecast";

/**
 * The property that must hold: label overrides are PRESENTATION ONLY. Two
 * initiatives with different wording but identical numbers must forecast
 * identically, or the "one tested code path" claim behind decision D1 is false.
 */

function filled(overrides: Partial<FunnelAnswers> = {}): FunnelAnswers {
  return {
    audienceReached: 3000,
    percents: { signed_up: 12, showed: 30, bought: 4 },
    averagePrice: 5000,
    ...overrides,
  };
}

describe("funnelFieldsFor", () => {
  it("always returns the three stages in order", () => {
    const fields = funnelFieldsFor("anything");
    expect(fields.map((f) => f.key)).toEqual(["signed_up", "showed", "bought"]);
  });

  it("uses default labels for an initiative with no override", () => {
    const fields = funnelFieldsFor("some_unmapped_initiative");
    expect(fields.map((f) => f.label)).toEqual([
      "% who signed up",
      "% who showed up or booked",
      "% who bought",
    ]);
  });

  // Mockup screen 5: the webinar asks about registering and showing up.
  it("uses the webinar wording from the mockup", () => {
    const labels = funnelFieldsFor("webinar").map((f) => f.label);
    expect(labels[0]).toBe("% who registered");
    expect(labels[1]).toBe("% who showed up");
  });

  // Mockup screen 6: the podcast asks about opting in and booking a call.
  it("uses the podcast wording from the mockup", () => {
    const labels = funnelFieldsFor("podcast-vodcast-guest").map((f) => f.label);
    expect(labels[0]).toBe("% who opted in");
    expect(labels[1]).toBe("% who booked a call");
  });

  /**
   * The overrides are keyed by `wb_initiative_library.initiative_key`, which is
   * slugged from the workbook's own naming — `webinar`, not `live_webinar_own`.
   * An invented key is a silent miss: the field renders with default wording and
   * nothing reports a problem, so these are pinned to the real keys.
   */
  it("keys every override by a real library slug", () => {
    for (const key of Object.keys(LABEL_OVERRIDES)) {
      expect(key, `"${key}" is not a library slug`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("falls back to defaults for null or undefined", () => {
    expect(funnelFieldsFor(null)[0].label).toBe("% who signed up");
    expect(funnelFieldsFor(undefined)[0].label).toBe("% who signed up");
  });

  it("keeps the field count identical for every initiative", () => {
    for (const key of ["live_webinar_own", "podcast_guest_ops", "unmapped", null]) {
      expect(funnelFieldsFor(key)).toHaveLength(FUNNEL_STAGES.length);
    }
  });
});

describe("label overrides are presentation only", () => {
  /**
   * The core guarantee of D1. Same numbers, different wording, same forecast —
   * so a copy change can never move a customer's revenue figure.
   */
  it("forecasts identically for differently-labelled initiatives", () => {
    const webinar = forecastPerRun(toInitiativeFunnel("live_webinar_own", filled()));
    const podcast = forecastPerRun(toInitiativeFunnel("podcast_guest_ops", filled()));
    const unmapped = forecastPerRun(toInitiativeFunnel("unmapped_thing", filled()));

    expect(webinar).toBeCloseTo(21600, 2);
    expect(podcast).toBe(webinar);
    expect(unmapped).toBe(webinar);
  });

  it("matches the mockup's per-run figure through this conversion", () => {
    // 3,000 x 12% x 30% x 4% = 4.32 buyers x $5,000 = $21,600.
    expect(forecastPerRun(toInitiativeFunnel("live_webinar_own", filled())))
      .toBeCloseTo(21600, 2);
  });
});

describe("toInitiativeFunnel", () => {
  it("carries all three percentages through in order", () => {
    const funnel = toInitiativeFunnel("live_webinar_own", filled());
    expect(funnel.stages.map((s) => s.percent)).toEqual([12, 30, 4]);
  });

  it("brackets the percentages with audience and price", () => {
    const funnel = toInitiativeFunnel("live_webinar_own", filled());
    expect(funnel.audienceReached).toBe(3000);
    expect(funnel.averagePrice).toBe(5000);
  });

  /**
   * The label is stored with the answer so a historic response reads back with
   * the question it was actually asked, even if the override is later reworded.
   */
  it("stores the label the user was shown", () => {
    const funnel = toInitiativeFunnel("podcast-vodcast-guest", filled());
    expect(funnel.stages[1].label).toBe("% who booked a call");
  });

  it("represents missing percentages as null, not zero", () => {
    const funnel = toInitiativeFunnel("live_webinar_own", filled({ percents: { signed_up: 12 } }));
    expect(funnel.stages.map((s) => s.percent)).toEqual([12, null, null]);
  });

  it("produces no forecast when a stage is missing", () => {
    const funnel = toInitiativeFunnel("live_webinar_own", filled({ percents: { signed_up: 12 } }));
    expect(forecastPerRun(funnel)).toBeNull();
  });
});

describe("fromStoredStages", () => {
  it("round-trips through toInitiativeFunnel", () => {
    const original = filled();
    const stored = toInitiativeFunnel("live_webinar_own", original);
    const restored = fromStoredStages(
      stored.audienceReached,
      stored.stages,
      stored.averagePrice
    );
    expect(restored).toEqual(original);
  });

  it("handles a null or empty stored array", () => {
    expect(fromStoredStages(100, null, 50)).toEqual({
      audienceReached: 100, percents: {}, averagePrice: 50,
    });
    expect(fromStoredStages(100, [], 50).percents).toEqual({});
  });

  // A stale key from an older schema must not become a form field.
  it("ignores unrecognised stage keys", () => {
    const restored = fromStoredStages(
      100,
      [{ key: "signed_up", percent: 10 }, { key: "legacy_stage", percent: 99 }],
      50
    );
    expect(restored.percents).toEqual({ signed_up: 10 });
  });

  it("preserves a stored null percentage", () => {
    const restored = fromStoredStages(100, [{ key: "bought", percent: null }], 50);
    expect(restored.percents.bought).toBeNull();
  });
});

describe("isFunnelComplete", () => {
  it("is true when all five inputs are present", () => {
    expect(isFunnelComplete(filled())).toBe(true);
  });

  it("is false on a blank funnel", () => {
    expect(isFunnelComplete(emptyFunnelAnswers())).toBe(false);
  });

  it("is false when any single stage is missing", () => {
    expect(isFunnelComplete(filled({ percents: { signed_up: 12, showed: 30 } }))).toBe(false);
    expect(isFunnelComplete(filled({ percents: { showed: 30, bought: 4 } }))).toBe(false);
  });

  it("is false without an audience or a price", () => {
    expect(isFunnelComplete(filled({ audienceReached: null }))).toBe(false);
    expect(isFunnelComplete(filled({ averagePrice: null }))).toBe(false);
  });

  /**
   * A zero audience or price cannot produce revenue, so it is treated as
   * incomplete — the card then shows a benchmark figure rather than claiming a
   * forecast of $0.
   */
  it("treats a zero audience or price as incomplete", () => {
    expect(isFunnelComplete(filled({ audienceReached: 0 }))).toBe(false);
    expect(isFunnelComplete(filled({ averagePrice: 0 }))).toBe(false);
  });

  // A genuine 0% conversion IS an answer — the user is telling us nobody bought.
  it("accepts a real zero percentage as answered", () => {
    expect(isFunnelComplete(filled({ percents: { signed_up: 12, showed: 30, bought: 0 } }))).toBe(true);
  });

  it("agrees with forecastPerRun about whether a forecast exists", () => {
    const cases = [
      filled(),
      filled({ percents: { signed_up: 12 } }),
      filled({ audienceReached: null }),
      filled({ averagePrice: null }),
      emptyFunnelAnswers(),
    ];
    for (const answers of cases) {
      const hasForecast = forecastPerRun(toInitiativeFunnel("x", answers)) !== null;
      expect(isFunnelComplete(answers)).toBe(hasForecast);
    }
  });
});

describe("funnelCompletedCount", () => {
  it("counts nothing on a blank funnel", () => {
    expect(funnelCompletedCount(emptyFunnelAnswers())).toBe(0);
  });

  it("counts all five when complete", () => {
    expect(funnelCompletedCount(filled())).toBe(FUNNEL_FIELD_COUNT);
  });

  it("counts partial progress", () => {
    expect(funnelCompletedCount(filled({ percents: { signed_up: 12 }, averagePrice: null })))
      .toBe(2);
  });

  it("counts a real zero as filled", () => {
    expect(funnelCompletedCount({
      audienceReached: 0, percents: { signed_up: 0 }, averagePrice: null,
    })).toBe(2);
  });
});
