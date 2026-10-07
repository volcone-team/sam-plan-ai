import { describe, it, expect } from "vitest";
import {
  isEligible,
  filterEligible,
  passesDidntWork,
  passesCapacity,
  passesSalesModel,
  passesIndustry,
  productCoverage,
  DOMINANT_PRODUCT_SHARE,
  MIN_HOURS_FOR_HIGH_EFFORT,
  NO_SALES_CALLS,
  type EligibilityContext,
} from "./eligibility";
import type { LibraryInitiative } from "@/lib/intake/library";

/**
 * One test per rule, per REQ-20.6. These are the rules that stop the AI
 * recommending something the user has just ruled out, so each is checked in
 * isolation as well as through `isEligible`.
 *
 * Fixtures mirror real `wb_initiative_library` rows.
 */

function entry(over: Partial<LibraryInitiative> & { key: string }): LibraryInitiative {
  return {
    name: over.key,
    category: null,
    oneLiner: null,
    ownOrOps: null,
    priceTier: null,
    difficulty: null,
    speedToResults: null,
    needsSalesTeam: null,
    ...over,
  };
}

const WEBINAR = entry({ key: "webinar", name: "Live Webinar", difficulty: 3, needsSalesTeam: "POSSIBLY" });
const SALES_CALLS = entry({ key: "sales-calls", name: "Sales Calls", difficulty: 2, needsSalesTeam: "YES" });
const REFERRAL = entry({ key: "referral", name: "Referral", difficulty: 1, needsSalesTeam: "YES" });
const PAID_ADS = entry({ key: "paid-ads", name: "Paid Ads", difficulty: 3, needsSalesTeam: "POSSIBLY" });
const HYBRID = entry({ key: "hybrid-events", name: "Hybrid Events", difficulty: 5, needsSalesTeam: "POSSIBLY" });
const PODCAST = entry({ key: "podcast-vodcast-guest", name: "Podcast Guest", difficulty: 3, needsSalesTeam: "NO" });

function ctx(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    industry: "Coaching & Consulting",
    didntWork: [],
    monthlyBudget: 2000,
    hoursPerWeek: 20,
    whoCloses: "me",
    stage: "momentum",
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * REQ-13.8
 * ------------------------------------------------------------------ */

describe("REQ-13.8 — excludes what didn't work", () => {
  /**
   * The only absolute rule. Recommending something the user said flopped
   * proves the plan ignored their answers, which is worse than recommending
   * nothing.
   */
  it("rejects an initiative on the didn't-work list", () => {
    const verdict = passesDidntWork(WEBINAR, ctx({ didntWork: ["webinar"] }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("didn't work");
  });

  it("allows one not on the list", () => {
    expect(passesDidntWork(WEBINAR, ctx({ didntWork: ["paid-ads"] })).eligible).toBe(true);
  });

  it("allows everything when the list is empty", () => {
    expect(passesDidntWork(WEBINAR, ctx({ didntWork: [] })).eligible).toBe(true);
  });

  // No other consideration overrides it.
  it("outranks every other rule", () => {
    const verdict = isEligible(
      WEBINAR,
      ctx({ didntWork: ["webinar"], monthlyBudget: 100000, hoursPerWeek: 60 })
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("didn't work");
  });
});

/* ------------------------------------------------------------------ *
 * REQ-13.9
 * ------------------------------------------------------------------ */

describe("REQ-13.9 — respects budget and hours", () => {
  it("rejects paid ads on a zero budget", () => {
    const verdict = passesCapacity(PAID_ADS, ctx({ monthlyBudget: 0 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("ad budget");
  });

  it("allows paid ads once there is a budget", () => {
    expect(passesCapacity(PAID_ADS, ctx({ monthlyBudget: 500 })).eligible).toBe(true);
  });

  it("does not gate unpaid initiatives on budget", () => {
    expect(passesCapacity(WEBINAR, ctx({ monthlyBudget: 0 })).eligible).toBe(true);
    expect(passesCapacity(PODCAST, ctx({ monthlyBudget: 0 })).eligible).toBe(true);
  });

  // Difficulty 5 is a flagship production; five hours a week sets them up to
  // fail publicly.
  it("rejects a high-effort initiative on few hours", () => {
    const verdict = passesCapacity(HYBRID, ctx({ hoursPerWeek: 5 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("hours a week");
  });

  it("allows a high-effort initiative with enough hours", () => {
    expect(
      passesCapacity(HYBRID, ctx({ hoursPerWeek: MIN_HOURS_FOR_HIGH_EFFORT })).eligible
    ).toBe(true);
  });

  /**
   * Hours is optional. Treating "did not say" as "has no time" would strip the
   * hardest-working initiatives from everyone who skipped the field — the
   * opposite of the null-is-not-zero rule the intake follows everywhere else.
   */
  it("does not exclude on unknown hours", () => {
    expect(passesCapacity(HYBRID, ctx({ hoursPerWeek: null })).eligible).toBe(true);
  });

  it("allows a low-effort initiative on almost no time", () => {
    expect(passesCapacity(REFERRAL, ctx({ hoursPerWeek: 2 })).eligible).toBe(true);
  });

  it("treats a null budget as nothing to spend", () => {
    expect(passesCapacity(PAID_ADS, ctx({ monthlyBudget: null })).eligible).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * REQ-13.10
 * ------------------------------------------------------------------ */

describe("REQ-13.10 — no sales calls when they don't take calls", () => {
  it("rejects a sales-call initiative", () => {
    const verdict = passesSalesModel(SALES_CALLS, ctx({ whoCloses: NO_SALES_CALLS }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("sales calls");
  });

  it("rejects every initiative the workbook marks YES", () => {
    for (const initiative of [SALES_CALLS, REFERRAL]) {
      expect(passesSalesModel(initiative, ctx({ whoCloses: NO_SALES_CALLS })).eligible)
        .toBe(false);
    }
  });

  /**
   * Most of the library is POSSIBLY. Treating that as YES would leave a
   * self-serve business with almost nothing — the rule would stop protecting
   * them and start blocking them.
   */
  it("allows POSSIBLY initiatives", () => {
    expect(passesSalesModel(WEBINAR, ctx({ whoCloses: NO_SALES_CALLS })).eligible).toBe(true);
  });

  it("allows NO initiatives", () => {
    expect(passesSalesModel(PODCAST, ctx({ whoCloses: NO_SALES_CALLS })).eligible).toBe(true);
  });

  it("applies no restriction for anyone who does take calls", () => {
    for (const whoCloses of ["me", "salesperson", "mix", null]) {
      expect(passesSalesModel(SALES_CALLS, ctx({ whoCloses })).eligible).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * REQ-13.12
 * ------------------------------------------------------------------ */

describe("REQ-13.12 — industry eligibility, honouring Broad fit", () => {
  /**
   * The library has no Ideal Industries column yet, so every initiative is
   * treated as Broad fit. That is the only honest reading of an absent
   * restriction, and REQ-4.2 already makes it correct for "Other".
   */
  it("allows everything while the column is unauthored", () => {
    expect(passesIndustry(WEBINAR, ctx({ industry: "E-commerce" })).eligible).toBe(true);
    expect(passesIndustry(WEBINAR, ctx({ industry: "Other" })).eligible).toBe(true);
    expect(passesIndustry(WEBINAR, ctx({ industry: null })).eligible).toBe(true);
  });

  // REQ-4.2 — Broad fit stays eligible for every industry, Other included.
  it("allows a Broad fit initiative for any industry", () => {
    const broad = { ...WEBINAR, idealIndustries: ["Broad fit"] } as LibraryInitiative;
    expect(passesIndustry(broad, ctx({ industry: "Network Marketing" })).eligible).toBe(true);
    expect(passesIndustry(broad, ctx({ industry: "Other" })).eligible).toBe(true);
    expect(passesIndustry(broad, ctx({ industry: null })).eligible).toBe(true);
  });

  it("allows a match on the user's industry", () => {
    const targeted = {
      ...WEBINAR,
      idealIndustries: ["Coaching & Consulting", "Course Creators"],
    } as LibraryInitiative;
    expect(passesIndustry(targeted, ctx({ industry: "Coaching & Consulting" })).eligible)
      .toBe(true);
  });

  it("rejects an industry the initiative is not for", () => {
    const targeted = { ...WEBINAR, idealIndustries: ["E-commerce"] } as LibraryInitiative;
    const verdict = passesIndustry(targeted, ctx({ industry: "Real Estate & Investing" }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toContain("Real Estate & Investing");
  });

  // "Other" is not in the library's vocabulary, so only Broad fit can match it.
  it("rejects a targeted initiative for Other", () => {
    const targeted = { ...WEBINAR, idealIndustries: ["E-commerce"] } as LibraryInitiative;
    expect(passesIndustry(targeted, ctx({ industry: "Other" })).eligible).toBe(false);
  });

  it("matches case-insensitively", () => {
    const targeted = { ...WEBINAR, idealIndustries: ["coaching & consulting"] } as LibraryInitiative;
    expect(passesIndustry(targeted, ctx({ industry: "Coaching & Consulting" })).eligible)
      .toBe(true);
  });

  // The column may arrive as a delimited string rather than an array.
  it("reads a comma-separated list", () => {
    const targeted = {
      ...WEBINAR,
      idealIndustries: "E-commerce, Local & Home Services",
    } as LibraryInitiative;
    expect(passesIndustry(targeted, ctx({ industry: "E-commerce" })).eligible).toBe(true);
    expect(passesIndustry(targeted, ctx({ industry: "B2B SaaS & Tech" })).eligible).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

describe("isEligible", () => {
  it("allows a well-matched initiative", () => {
    expect(isEligible(WEBINAR, ctx()).eligible).toBe(true);
  });

  it("names the most decisive rejection first", () => {
    // Both the didn't-work rule and the sales-model rule reject this.
    const verdict = isEligible(
      SALES_CALLS,
      ctx({ didntWork: ["sales-calls"], whoCloses: NO_SALES_CALLS })
    );
    expect(verdict.reason).toContain("didn't work");
  });

  it("always gives a reason when it rejects", () => {
    const verdict = isEligible(PAID_ADS, ctx({ monthlyBudget: 0 }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBeTruthy();
  });

  it("gives no reason when it allows", () => {
    expect(isEligible(WEBINAR, ctx()).reason).toBeNull();
  });
});

describe("filterEligible", () => {
  const all = [WEBINAR, SALES_CALLS, PAID_ADS, HYBRID, PODCAST, REFERRAL];

  it("keeps the input order", () => {
    const kept = filterEligible(all, ctx());
    expect(kept.map((e) => e.key)).toEqual(all.map((e) => e.key));
  });

  /**
   * The compounding case: a self-serve business with no budget and little time
   * is exactly who the rules exist to protect, and the shortlist must still
   * contain something.
   */
  it("still returns something for a tightly constrained user", () => {
    const kept = filterEligible(
      all,
      ctx({ whoCloses: NO_SALES_CALLS, monthlyBudget: 0, hoursPerWeek: 5 })
    );
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.map((e) => e.key)).not.toContain("sales-calls");
    expect(kept.map((e) => e.key)).not.toContain("paid-ads");
    expect(kept.map((e) => e.key)).not.toContain("hybrid-events");
    expect(kept.map((e) => e.key)).toContain("webinar");
  });

  it("returns nothing when everything is excluded", () => {
    expect(filterEligible([SALES_CALLS], ctx({ whoCloses: NO_SALES_CALLS }))).toEqual([]);
  });

  it("handles an empty library", () => {
    expect(filterEligible([], ctx())).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * REQ-13.11
 * ------------------------------------------------------------------ */

describe("REQ-13.11 — coverage of the products carrying the goal", () => {
  const products = [
    { id: "p1", name: "Flagship program", goal: 600_000 },
    { id: "p2", name: "Starter course", goal: 150_000 },
  ];

  /**
   * A product carrying most of the goal behind a single initiative is the
   * plan's single point of failure: if that one campaign underperforms, the
   * whole year misses.
   */
  it("flags a dominant product with one initiative", () => {
    const coverage = productCoverage(products, new Map([["p1", 1], ["p2", 1]]));
    const flagship = coverage.find((c) => c.productId === "p1")!;

    expect(flagship.share).toBeGreaterThan(DOMINANT_PRODUCT_SHARE);
    expect(flagship.underCovered).toBe(true);
  });

  it("clears a dominant product once it has two", () => {
    const coverage = productCoverage(products, new Map([["p1", 2], ["p2", 1]]));
    expect(coverage.find((c) => c.productId === "p1")!.underCovered).toBe(false);
  });

  // The rule is about products carrying the plan, not every product.
  it("does not flag a minor product with one initiative", () => {
    const coverage = productCoverage(products, new Map([["p1", 2], ["p2", 1]]));
    expect(coverage.find((c) => c.productId === "p2")!.underCovered).toBe(false);
  });

  it("flags a product with no initiatives at all", () => {
    const coverage = productCoverage(products, new Map([["p2", 1]]));
    const flagship = coverage.find((c) => c.productId === "p1")!;
    expect(flagship.initiativeCount).toBe(0);
    expect(flagship.underCovered).toBe(true);
  });

  it("computes shares that sum to one", () => {
    const total = productCoverage(products, new Map()).reduce((s, c) => s + c.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  // An even split means no single product carries the plan.
  it("flags nothing when the goal is evenly split", () => {
    const even = [
      { id: "a", name: "A", goal: 100_000 },
      { id: "b", name: "B", goal: 100_000 },
    ];
    const coverage = productCoverage(even, new Map());
    expect(coverage.every((c) => !c.underCovered)).toBe(true);
  });

  it("does not divide by zero when no product has a goal", () => {
    const coverage = productCoverage(
      [{ id: "a", name: "A", goal: 0 }],
      new Map()
    );
    expect(coverage[0].share).toBe(0);
    expect(coverage[0].underCovered).toBe(false);
  });

  it("handles no products", () => {
    expect(productCoverage([], new Map())).toEqual([]);
  });
});
