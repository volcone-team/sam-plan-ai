import { describe, it, expect } from "vitest";
import {
  sizeForStage,
  recommendationCount,
  withinStageRange,
  describeStageRange,
  isStage,
} from "./sizing";

/**
 * REQ-13.13's bounds. The failure this guards against is a Start-stage
 * business handed six initiatives and running none of them.
 */

describe("sizeForStage", () => {
  it("matches the requirement's ranges", () => {
    expect(sizeForStage("start")).toMatchObject({ min: 1, max: 2 });
    expect(sizeForStage("momentum")).toMatchObject({ min: 2, max: 4 });
    // "4 or more" — open-ended, capped by the plan limit rather than here.
    expect(sizeForStage("scale")).toMatchObject({ min: 4, max: null });
  });

  it("falls back to momentum on a missing or unknown stage", () => {
    expect(sizeForStage(null)).toEqual(sizeForStage("momentum"));
    expect(sizeForStage("nonsense")).toEqual(sizeForStage("momentum"));
  });
});

describe("isStage", () => {
  it("recognises the three stages and nothing else", () => {
    expect(isStage("start")).toBe(true);
    expect(isStage("momentum")).toBe(true);
    expect(isStage("scale")).toBe(true);
    expect(isStage("Start")).toBe(false);
    expect(isStage(null)).toBe(false);
  });
});

describe("recommendationCount", () => {
  it("fills the stage target for someone with nothing planned", () => {
    expect(recommendationCount({ stage: "start", existingCount: 0, gapToGoal: 500_000 }))
      .toBe(2);
    expect(recommendationCount({ stage: "momentum", existingCount: 0, gapToGoal: 500_000 }))
      .toBe(3);
    expect(recommendationCount({ stage: "scale", existingCount: 0, gapToGoal: 500_000 }))
      .toBe(5);
  });

  /**
   * Someone at Momentum who already planned three does not need three more.
   * Counting their own initiatives against the stage budget is what stops Path
   * A users being handed a second plan on top of their own.
   */
  it("counts what the user already planned against the budget", () => {
    expect(recommendationCount({ stage: "momentum", existingCount: 2, gapToGoal: 100_000 }))
      .toBe(1);
    expect(recommendationCount({ stage: "start", existingCount: 1, gapToGoal: 100_000 }))
      .toBe(1);
  });

  /**
   * Nothing to close means nothing to recommend. Adding initiatives anyway
   * would manufacture work to justify the screen.
   */
  it("recommends nothing when the goal is already covered", () => {
    expect(recommendationCount({ stage: "scale", existingCount: 0, gapToGoal: 0 })).toBe(0);
    expect(recommendationCount({ stage: "start", existingCount: 0, gapToGoal: -50_000 }))
      .toBe(0);
  });

  /**
   * A gap with no room left in the stage budget still gets one suggestion.
   * Showing a shortfall with no way to address it tells the user they have a
   * problem and nothing to do about it.
   */
  it("still offers one when the stage budget is full but a gap remains", () => {
    const count = recommendationCount({
      stage: "start",
      existingCount: 1,
      gapToGoal: 400_000,
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("offers nothing once the user is at the stage ceiling", () => {
    expect(recommendationCount({ stage: "start", existingCount: 2, gapToGoal: 400_000 }))
      .toBe(0);
  });

  it("does not go negative when the user is over the ceiling", () => {
    expect(recommendationCount({ stage: "start", existingCount: 9, gapToGoal: 400_000 }))
      .toBe(0);
  });

  /**
   * REQ-13.15 — billing enforces max_initiatives server-side anyway, so
   * proposing more here only fails later with a worse message.
   */
  it("never proposes more than the plan can hold", () => {
    expect(
      recommendationCount({
        stage: "scale",
        existingCount: 2,
        gapToGoal: 500_000,
        planLimit: 3,
      })
    ).toBe(1);
  });

  it("proposes nothing when the plan limit is already reached", () => {
    expect(
      recommendationCount({
        stage: "scale",
        existingCount: 5,
        gapToGoal: 500_000,
        planLimit: 5,
      })
    ).toBe(0);
  });

  it("is unconstrained when no plan limit applies", () => {
    expect(
      recommendationCount({
        stage: "scale",
        existingCount: 0,
        gapToGoal: 500_000,
        planLimit: null,
      })
    ).toBe(5);
  });

  it("tolerates a fractional or negative existing count", () => {
    expect(recommendationCount({ stage: "momentum", existingCount: -3, gapToGoal: 100 }))
      .toBe(3);
    expect(recommendationCount({ stage: "momentum", existingCount: 1.7, gapToGoal: 100 }))
      .toBe(2);
  });
});

describe("withinStageRange", () => {
  it("accepts a count inside the range", () => {
    expect(withinStageRange("start", 1)).toBe(true);
    expect(withinStageRange("start", 2)).toBe(true);
    expect(withinStageRange("momentum", 3)).toBe(true);
  });

  it("rejects a count below the minimum", () => {
    expect(withinStageRange("momentum", 1)).toBe(false);
    expect(withinStageRange("scale", 3)).toBe(false);
  });

  it("rejects a count above the maximum", () => {
    expect(withinStageRange("start", 3)).toBe(false);
    expect(withinStageRange("momentum", 5)).toBe(false);
  });

  // Scale is open-ended by design.
  it("accepts any count at or above the Scale minimum", () => {
    expect(withinStageRange("scale", 4)).toBe(true);
    expect(withinStageRange("scale", 12)).toBe(true);
  });
});

describe("describeStageRange", () => {
  it("reads naturally for the screen copy", () => {
    expect(describeStageRange("start")).toBe("1 to 2");
    expect(describeStageRange("momentum")).toBe("2 to 4");
    expect(describeStageRange("scale")).toBe("4 or more");
  });
});
