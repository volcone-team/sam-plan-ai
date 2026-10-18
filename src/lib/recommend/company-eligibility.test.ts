import { describe, expect, it } from "vitest";
import {
  eligibilityContextFromIntake,
  partitionLibrary,
  rejectionReason,
  type IntakeSnapshot,
} from "@/lib/recommend/company-eligibility";
import { isEligible, NO_SALES_CALLS } from "@/lib/recommend/eligibility";
import { toLibraryEntry, type LibraryEntry } from "@/lib/workbook/read";
import type { LibraryInitiative } from "@/lib/intake/library";

function lib(key: string, over: Record<string, unknown> = {}): LibraryEntry {
  return toLibraryEntry({ initiative_key: key, name: key, ...over });
}

describe("eligibilityContextFromIntake", () => {
  it("builds the context the recommend route used to build inline", () => {
    const intake: IntakeSnapshot = {
      input: {
        industry: "E-commerce",
        monthly_marketing_budget: "250",
        weekly_hours: 6,
        sales_owner: NO_SALES_CALLS,
        growth_stage: "start",
      },
      products: [{ average_price: 40 }, { average_price: null, price_level: "high" }, { average_price: null }],
      initiatives: [
        { source: "failed", initiative_key: "webinar" },
        { source: "planned", initiative_key: "podcast" },
        { source: "failed", initiative_key: "" },
      ],
    };
    const inactive = new Set(["ads"]);
    expect(eligibilityContextFromIntake(intake, inactive)).toEqual({
      industry: "E-commerce",
      didntWork: ["webinar"],
      monthlyBudget: 250,
      hoursPerWeek: 6,
      whoCloses: NO_SALES_CALLS,
      stage: "start",
      inactiveKeys: inactive,
      productTiers: ["low", "high"],
    });
  });

  it("gives an all-null context without an intake", () => {
    expect(eligibilityContextFromIntake(null)).toMatchObject({
      industry: null,
      didntWork: [],
      monthlyBudget: null,
      hoursPerWeek: null,
      whoCloses: null,
      stage: null,
      productTiers: [],
    });
  });
});

/* ------------------------------------------------------------------ *
 * No intake: nothing is filtered except the allowlist (seeded)
 * ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("an all-null context passes everything but the allowlist", () => {
  it("holds for random library rows", () => {
    const rand = mulberry32(2026);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let run = 0; run < 500; run++) {
      const initiative: LibraryInitiative = {
        key: pick(["paid-ads", "webinar", "sales-calls", "hybrid-events", `k${run}`]),
        name: "x",
        category: null,
        oneLiner: null,
        ownOrOps: pick([null, "OWN", "OPS"]),
        priceTier: pick([null, "Low", "High", "Mid → High", "garbage"]),
        difficulty: pick([null, 1, 3, 5]),
        speedToResults: null,
        needsSalesTeam: pick([null, "YES", "NO", "POSSIBLY"]),
        idealIndustries: pick([[], ["E-commerce"], ["Broad fit"], ["Real Estate & Investing", "SaaS & Tech"]]),
      };
      expect(isEligible(initiative, eligibilityContextFromIntake(null)).eligible).toBe(true);

      const off = eligibilityContextFromIntake(null, new Set([initiative.key]));
      expect(isEligible(initiative, off)).toEqual({
        eligible: false,
        reason: "This initiative isn't currently offered.",
      });
    }
  });
});

describe("partitionLibrary", () => {
  const strong = lib("strong", { speed_score: 5, cost_score: 5, odds_score: 5, revenue_score: 5, ease_score: 5 });
  const weak = lib("weak", { speed_score: 1, cost_score: 1, odds_score: 1, revenue_score: 1, ease_score: 1 });
  const sales = lib("sales-calls", { needs_sales_team: "YES", speed_score: 5, cost_score: 5, odds_score: 5, revenue_score: 5, ease_score: 4 });

  it("ranks the eligible by SCORE and keeps the reasons for the rest", () => {
    const ctx = { ...eligibilityContextFromIntake(null), whoCloses: NO_SALES_CALLS };
    const { eligible, ineligible } = partitionLibrary([weak, sales, strong], ctx, 1);
    expect(eligible.map((e) => e.initiativeKey)).toEqual(["strong", "weak"]);
    expect(ineligible).toEqual([{ entry: sales, reason: "This needs someone to take sales calls." }]);
  });

  it("passes everything without an intake", () => {
    const { eligible } = partitionLibrary([weak, sales, strong], eligibilityContextFromIntake(null), 2);
    expect(eligible.map((e) => e.initiativeKey)).toEqual(["strong", "sales-calls", "weak"]);
  });
});

describe("rejectionReason", () => {
  it("names the rule for an ineligible key and passes the rest", () => {
    const ctx = { ...eligibilityContextFromIntake(null, new Set(["off"])), didntWork: ["flop"] };
    expect(rejectionReason(lib("off"), ctx)).toBe("This initiative isn't currently offered.");
    expect(rejectionReason(lib("flop"), ctx)).toBe("You told us this one didn't work for you.");
    expect(rejectionReason(lib("fine"), ctx)).toBeNull();
    expect(rejectionReason(undefined, ctx)).toBeNull();
  });
});
