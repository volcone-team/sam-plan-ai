import { describe, it, expect } from "vitest";
import { nextBestAlternative, canSwap, swapInPlace, type SwapContext } from "./swap";
import { NO_SALES_CALLS } from "./eligibility";
import type { LibraryInitiative } from "@/lib/intake/library";

/**
 * D3's guarantees: a swap honours every eligibility rule, never repeats
 * something already on screen, and returns null when exhausted so the control
 * can disable itself rather than appearing live and doing nothing.
 */

function entry(over: Partial<LibraryInitiative> & { key: string }): LibraryInitiative {
  return {
    name: over.key,
    category: null,
    oneLiner: null,
    ownOrOps: null,
    priceTier: null,
    difficulty: 2,
    speedToResults: null,
    needsSalesTeam: null,
    ...over,
  };
}

const WEBINAR = entry({ key: "webinar" });
const PODCAST = entry({ key: "podcast-vodcast-guest" });
const EMAIL = entry({ key: "email-campaign" });
const PAID_ADS = entry({ key: "paid-ads" });
const SALES_CALLS = entry({ key: "sales-calls", needsSalesTeam: "YES" });

/** Ranked as the model returned them. */
const RANKED = [WEBINAR, PODCAST, EMAIL, PAID_ADS, SALES_CALLS];

function ctx(over: Partial<SwapContext> = {}): SwapContext {
  return {
    industry: "Coaching & Consulting",
    didntWork: [],
    monthlyBudget: 2000,
    hoursPerWeek: 20,
    whoCloses: "me",
    stage: "momentum",
    alreadyShown: [],
    ...over,
  };
}

describe("nextBestAlternative", () => {
  // "Next best" means the model's own preference, filtered — not alphabetical.
  it("returns the highest-ranked unseen initiative", () => {
    expect(nextBestAlternative(RANKED, ctx())?.key).toBe("webinar");
  });

  it("walks down the list as more are seen", () => {
    expect(nextBestAlternative(RANKED, ctx({ alreadyShown: ["webinar"] }))?.key)
      .toBe("podcast-vodcast-guest");
    expect(
      nextBestAlternative(
        RANKED,
        ctx({ alreadyShown: ["webinar", "podcast-vodcast-guest"] })
      )?.key
    ).toBe("email-campaign");
  });

  /**
   * The ranked list came from the model, so eligibility is re-checked rather
   * than trusted — a swap must honour the same rules the original
   * recommendation did.
   */
  it("skips an ineligible candidate", () => {
    const candidate = nextBestAlternative(
      RANKED,
      ctx({
        alreadyShown: ["webinar", "podcast-vodcast-guest", "email-campaign"],
        monthlyBudget: 0,
      })
    );
    // paid-ads needs a budget, sales-calls is still fine for someone who calls.
    expect(candidate?.key).toBe("sales-calls");
  });

  it("skips anything on the didn't-work list", () => {
    expect(nextBestAlternative(RANKED, ctx({ didntWork: ["webinar"] }))?.key)
      .toBe("podcast-vodcast-guest");
  });

  it("honours the sales-call rule", () => {
    const candidate = nextBestAlternative(
      RANKED,
      ctx({
        whoCloses: NO_SALES_CALLS,
        alreadyShown: ["webinar", "podcast-vodcast-guest", "email-campaign", "paid-ads"],
      })
    );
    expect(candidate).toBeNull();
  });

  // Exhaustion returns null so the control can disable itself.
  it("returns null when everything has been seen", () => {
    expect(
      nextBestAlternative(RANKED, ctx({ alreadyShown: RANKED.map((e) => e.key) }))
    ).toBeNull();
  });

  it("returns null on an empty ranked list", () => {
    expect(nextBestAlternative([], ctx())).toBeNull();
  });

  it("never returns something already shown", () => {
    const shown = ["webinar", "email-campaign"];
    const candidate = nextBestAlternative(RANKED, ctx({ alreadyShown: shown }));
    expect(shown).not.toContain(candidate?.key);
  });
});

describe("canSwap", () => {
  /**
   * Checked before the click so the control is disabled up front, rather than
   * appearing live and then doing nothing — which reads as a bug.
   */
  it("is true while an alternative remains", () => {
    expect(canSwap(RANKED, ctx())).toBe(true);
  });

  it("is false once exhausted", () => {
    expect(canSwap(RANKED, ctx({ alreadyShown: RANKED.map((e) => e.key) }))).toBe(false);
  });

  it("agrees with nextBestAlternative", () => {
    const context = ctx({ alreadyShown: ["webinar", "podcast-vodcast-guest"] });
    expect(canSwap(RANKED, context)).toBe(nextBestAlternative(RANKED, context) !== null);
  });
});

describe("swapInPlace", () => {
  const shortlist = [WEBINAR, PODCAST];

  /**
   * The replacement takes the outgoing card's POSITION. The list is ranked, so
   * appending would quietly demote the slot and reorder the screen under the
   * user mid-decision.
   */
  it("replaces in position rather than appending", () => {
    const { shortlist: next, replacement } = swapInPlace(
      shortlist,
      "webinar",
      RANKED,
      ctx()
    );
    expect(replacement?.key).toBe("email-campaign");
    expect(next.map((e) => e.key)).toEqual(["email-campaign", "podcast-vodcast-guest"]);
  });

  // Otherwise a swap could surface a card already sitting two rows down.
  it("never produces a duplicate of something on screen", () => {
    const { shortlist: next } = swapInPlace(shortlist, "webinar", RANKED, ctx());
    expect(new Set(next.map((e) => e.key)).size).toBe(next.length);
  });

  it("keeps the list length", () => {
    const { shortlist: next } = swapInPlace(shortlist, "webinar", RANKED, ctx());
    expect(next).toHaveLength(shortlist.length);
  });

  /**
   * Nothing eligible left: the card STAYS. Losing it would shrink the plan as a
   * side effect of asking for an alternative.
   */
  it("leaves the card in place when nothing is left", () => {
    const { shortlist: next, replacement } = swapInPlace(
      shortlist,
      "webinar",
      RANKED,
      ctx({ alreadyShown: RANKED.map((e) => e.key) })
    );
    expect(replacement).toBeNull();
    expect(next.map((e) => e.key)).toEqual(["webinar", "podcast-vodcast-guest"]);
  });

  it("is a no-op for a key not on the shortlist", () => {
    const { shortlist: next, replacement } = swapInPlace(
      shortlist,
      "not-present",
      RANKED,
      ctx()
    );
    expect(replacement).toBeNull();
    expect(next.map((e) => e.key)).toEqual(shortlist.map((e) => e.key));
  });

  it("does not mutate the shortlist it was given", () => {
    const original = [...shortlist];
    swapInPlace(shortlist, "webinar", RANKED, ctx());
    expect(shortlist).toEqual(original);
  });

  // Swapping repeatedly is how someone browses alternatives.
  it("walks further down the list on repeated swaps", () => {
    let current: LibraryInitiative[] = [...shortlist];
    const seen: string[] = [];

    for (let i = 0; i < 2; i += 1) {
      const result = swapInPlace(current, current[0].key, RANKED, ctx({ alreadyShown: seen }));
      if (!result.replacement) break;
      seen.push(current[0].key);
      current = result.shortlist;
    }

    expect(current[0].key).not.toBe("webinar");
  });
});
