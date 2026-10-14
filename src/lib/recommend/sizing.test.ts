import { describe, it, expect } from "vitest";
import {
  sizeForStage,
  recommendationCount,
  recommendationCapacity,
  withinStageRange,
  describeStageRange,
  isStage,
  MAX_RECOMMENDED_INITIATIVES,
  MIN_RECOMMENDED_INITIATIVES,
  SWAP_RESERVE,
} from "./sizing";

/**
 * REQ-13.13's bounds, plus the hard ceiling the owner added on top.
 *
 * Two failures are guarded here. The original one: a Start-stage business
 * handed six initiatives and running none of them. And the new one: Scale being
 * open-ended meant a customer on a large plan could be given eight or nine,
 * which is the same mistake further up the range.
 */

describe("MAX_RECOMMENDED_INITIATIVES", () => {
  it("is five, and no advisory range describes more", () => {
    expect(MAX_RECOMMENDED_INITIATIVES).toBe(5);
    for (const stage of ["start", "momentum", "scale"] as const) {
      const { max, target } = sizeForStage(stage);
      expect(max).not.toBeNull();
      expect(max!).toBeLessThanOrEqual(MAX_RECOMMENDED_INITIATIVES);
      expect(target).toBeLessThanOrEqual(MAX_RECOMMENDED_INITIATIVES);
    }
  });

  /**
   * The stage ranges are advisory copy only. If one of them ever starts
   * capping capacity again, "0 of 2 selected" comes back.
   */
  it("is not reduced by any growth stage", () => {
    expect(recommendationCapacity({})).toBe(MAX_RECOMMENDED_INITIATIVES);
  });
});

describe("MIN_RECOMMENDED_INITIATIVES and SWAP_RESERVE", () => {
  it("expresses the owner's 3-5 rule", () => {
    expect(MIN_RECOMMENDED_INITIATIVES).toBe(3);
    expect(MAX_RECOMMENDED_INITIATIVES).toBe(5);
    expect(MIN_RECOMMENDED_INITIATIVES).toBeLessThan(MAX_RECOMMENDED_INITIATIVES);
  });

  it("reserves enough for a user to reject a whole shortlist once", () => {
    expect(SWAP_RESERVE).toBeGreaterThanOrEqual(MIN_RECOMMENDED_INITIATIVES);
  });
});

describe("sizeForStage", () => {
  it("keeps the requirement's ranges, with Scale now bounded", () => {
    expect(sizeForStage("start")).toMatchObject({ min: 1, max: 2 });
    expect(sizeForStage("momentum")).toMatchObject({ min: 2, max: 4 });
    // Was "4 or more" with max: null. Now capped at the hard ceiling.
    expect(sizeForStage("scale")).toMatchObject({ min: 4, max: 5 });
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

describe("recommendationCapacity — the cap on OUR suggestions", () => {
  /**
   * FIVE FOR EVERYONE. The stage used to cap this, so a Start-stage business
   * saw "0 of 2 selected" and could never reach the five the product offers.
   * A stage is a statement about ambition, not entitlement.
   */
  it("is five regardless of growth stage", () => {
    expect(recommendationCapacity({})).toBe(5);
    expect(recommendationCapacity({ planLimit: null })).toBe(5);
    expect(recommendationCapacity({ planLimit: 10 })).toBe(5);
  });

  it("never exceeds five, whatever the plan allows", () => {
    for (const planLimit of [5, 8, 10, 20, 100]) {
      expect(recommendationCapacity({ planLimit })).toBe(MAX_RECOMMENDED_INITIATIVES);
    }
  });

  /**
   * REQ-13.15 — a smaller plan limit still wins, because billing re-checks
   * max_initiatives when the plan is built. Inert at current settings (Starter
   * allows 10, Pro and Mastery are unlimited) but it has to hold if a tier is
   * ever tightened.
   */
  it("lets a smaller plan limit win", () => {
    expect(recommendationCapacity({ planLimit: 3 })).toBe(3);
    expect(recommendationCapacity({ planLimit: 1 })).toBe(1);
  });

  /**
   * -1 IS "UNLIMITED" IN THIS PROJECT, not a limit of minus one. Treating it
   * literally would clamp capacity to zero and give every Pro and Mastery
   * customer no recommendations at all.
   */
  it("treats -1 as unlimited, not as zero", () => {
    expect(recommendationCapacity({ planLimit: -1 })).toBe(5);
    expect(recommendationCapacity({ planLimit: -99 })).toBe(5);
  });

  it("is zero only for a plan that genuinely allows nothing", () => {
    expect(recommendationCapacity({ planLimit: 0 })).toBe(0);
  });

  it("floors a fractional plan limit rather than rounding up", () => {
    expect(recommendationCapacity({ planLimit: 2.9 })).toBe(2);
  });
});

describe("recommendationCount — alternatives, not top-ups", () => {
  it("offers as many contenders as may be accepted, five for everyone", () => {
    expect(recommendationCount({})).toBe(5);
    expect(recommendationCount({ planLimit: null })).toBe(5);
    expect(recommendationCount({ planLimit: 10 })).toBe(5);
  });

  /**
   * THE PRODUCT CHANGE, stated as a test.
   *
   * This used to subtract the user's own initiatives from the stage budget, so
   * someone who had already entered four saw at most one suggestion. They are
   * now shown a full set of CONTENDERS and pick up to the cap from the combined
   * pool — so having four of their own is a reason to show four alternatives,
   * not a reason to show one.
   */
  it("does not shrink because the user already has initiatives", () => {
    expect(recommendationCount({})).toBe(5);
  });

  /**
   * Also changed: a plan that already covers the revenue goal can still be a
   * worse plan than the alternatives, and the user is the one qualified to
   * judge that. It used to return zero.
   */
  it("still offers alternatives when the revenue goal is covered", () => {
    expect(recommendationCount({})).toBeGreaterThan(0);
  });

  it("never proposes more than five", () => {
    for (const planLimit of [5, 9, 50, null, undefined]) {
      expect(recommendationCount({ planLimit }))
        .toBeLessThanOrEqual(MAX_RECOMMENDED_INITIATIVES);
    }
  });

  it("respects a smaller plan limit", () => {
    expect(recommendationCount({ planLimit: 3 })).toBe(3);
    expect(recommendationCount({ planLimit: 2 })).toBe(2);
  });

  it("offers nothing when the plan can hold nothing", () => {
    expect(recommendationCount({ planLimit: 0 })).toBe(0);
  });

  it("agrees with recommendationCapacity when the pool is unknown", () => {
    for (const planLimit of [null, undefined, 0, 1, 3, 5, 10, -1]) {
      expect(recommendationCount({ planLimit })).toBe(recommendationCapacity({ planLimit }));
    }
  });
});

/**
 * THE BUG THIS GUARDS.
 *
 * Swap replaces a card with the next unseen alternative, and alternatives are
 * whatever the shortlist did not take. Six initiatives were active, the
 * shortlist asked for five, one of the user's own overlapped — leaving zero
 * alternatives and a Swap button disabled on every card from page load.
 */
describe("recommendationCount — leaving room to swap", () => {
  it("holds a reserve back instead of filling to the cap", () => {
    // Pool of 6: five shown would leave one. Three shown leaves three.
    expect(recommendationCount({ poolSize: 6 })).toBe(3);
  });

  it("shows the full five once the pool can afford the reserve too", () => {
    expect(recommendationCount({ poolSize: 8 })).toBe(5);
    expect(recommendationCount({ poolSize: 22 })).toBe(5);
  });

  it("always leaves something to swap to when the pool allows it", () => {
    for (const poolSize of [4, 5, 6, 7, 8, 10, 22]) {
      const shown = recommendationCount({ poolSize });
      expect(poolSize - shown, `pool ${poolSize}`).toBeGreaterThan(0);
    }
  });

  /**
   * The minimum wins over the reserve. A shortlist of one is not a choice, and
   * the screen exists to offer one.
   */
  it("never drops below three to protect the reserve", () => {
    expect(recommendationCount({ poolSize: 4 })).toBe(3);
    expect(recommendationCount({ poolSize: 5 })).toBe(3);
    expect(recommendationCount({ poolSize: 6 })).toBe(3);
  });

  /** Cannot invent candidates: a pool of two shows two, not three. */
  it("never shows more than the pool holds", () => {
    expect(recommendationCount({ poolSize: 2 })).toBe(2);
    expect(recommendationCount({ poolSize: 1 })).toBe(1);
    expect(recommendationCount({ poolSize: 0 })).toBe(0);
  });

  it("still respects the cap and a smaller plan limit", () => {
    expect(recommendationCount({ poolSize: 22 })).toBeLessThanOrEqual(
      MAX_RECOMMENDED_INITIATIVES
    );
    expect(recommendationCount({ poolSize: 22, planLimit: 2 })).toBe(2);
  });

  it("offers nothing when the plan can hold nothing, whatever the pool", () => {
    expect(recommendationCount({ poolSize: 22, planLimit: 0 })).toBe(0);
  });

  it("handles a nonsense pool size without throwing", () => {
    expect(recommendationCount({ poolSize: -5 })).toBe(0);
    expect(recommendationCount({ poolSize: 6.9 })).toBe(3);
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

  /** Scale is no longer open-ended: five is in range, six is not. */
  it("caps Scale at five", () => {
    expect(withinStageRange("scale", 4)).toBe(true);
    expect(withinStageRange("scale", 5)).toBe(true);
    expect(withinStageRange("scale", 6)).toBe(false);
    expect(withinStageRange("scale", 12)).toBe(false);
  });
});

describe("describeStageRange", () => {
  it("reads naturally for the screen copy", () => {
    expect(describeStageRange("start")).toBe("1 to 2");
    expect(describeStageRange("momentum")).toBe("2 to 4");
    // Was "4 or more". Describing it as open-ended would promise a plan we no
    // longer build.
    expect(describeStageRange("scale")).toBe("4 to 5");
  });

  it("never claims an open-ended range", () => {
    for (const stage of ["start", "momentum", "scale", null, "nonsense"]) {
      expect(describeStageRange(stage)).not.toMatch(/or more/);
    }
  });
});
