import { describe, it, expect } from "vitest";
import {
  productPriceTier,
  tierFromPriceLevel,
  intakeProductTier,
  parseInitiativeTierRange,
  describeTierRange,
  MID_TIER_MIN_PRICE,
  HIGH_TIER_MIN_PRICE,
  type PriceTier,
} from "./price-tier";

const set = (...tiers: PriceTier[]) => new Set<PriceTier>(tiers);

describe("productPriceTier", () => {
  it("classes prices at the boundaries", () => {
    expect(productPriceTier(0)).toBe("low");
    expect(productPriceTier(MID_TIER_MIN_PRICE - 0.01)).toBe("low");
    expect(productPriceTier(MID_TIER_MIN_PRICE)).toBe("mid");
    expect(productPriceTier(HIGH_TIER_MIN_PRICE - 0.01)).toBe("mid");
    expect(productPriceTier(HIGH_TIER_MIN_PRICE)).toBe("high");
  });

  it("matches the ranges the intake shows the user", () => {
    // PRICE_TIER_OPTIONS: "Under $500", "$500 to $5,000", "$5,000 and up".
    expect(MID_TIER_MIN_PRICE).toBe(500);
    expect(HIGH_TIER_MIN_PRICE).toBe(5000);
  });

  it("returns null for no usable price", () => {
    expect(productPriceTier(null)).toBeNull();
    expect(productPriceTier(undefined)).toBeNull();
    expect(productPriceTier(Number.NaN)).toBeNull();
    expect(productPriceTier(-1)).toBeNull();
  });
});

describe("tierFromPriceLevel / intakeProductTier", () => {
  it("reads the three tiers and treats one-on-one as unknown", () => {
    expect(tierFromPriceLevel("low")).toBe("low");
    expect(tierFromPriceLevel("mid")).toBe("mid");
    expect(tierFromPriceLevel("high")).toBe("high");
    expect(tierFromPriceLevel("one_to_one")).toBeNull();
    expect(tierFromPriceLevel(null)).toBeNull();
  });

  it("prefers the real average price over the picked level", () => {
    // NUMERIC arrives from PostgREST as a number or a numeric string.
    expect(intakeProductTier({ average_price: "199.00", price_level: "high" })).toBe("low");
    expect(intakeProductTier({ average_price: 7500, price_level: "low" })).toBe("high");
  });

  it("falls back to the level when there is no price", () => {
    expect(intakeProductTier({ average_price: null, price_level: "mid" })).toBe("mid");
    expect(intakeProductTier({ average_price: "", price_level: "high" })).toBe("high");
    expect(intakeProductTier({ average_price: null, price_level: "one_to_one" })).toBeNull();
    expect(intakeProductTier({})).toBeNull();
  });
});

describe("parseInitiativeTierRange", () => {
  // Every distinct value in the live wb_initiative_library, plus the
  // slash form the methodology doc uses.
  it.each<[string, PriceTier[]]>([
    ["Low", ["low"]],
    ["Mid", ["mid"]],
    ["High", ["high"]],
    ["Low → Mid", ["low", "mid"]],
    ["Mid → High", ["mid", "high"]],
    ["Mid/High", ["mid", "high"]],
  ])("parses the real value %j", (raw, expected) => {
    expect(parseInitiativeTierRange(raw)).toEqual(set(...expected));
  });

  it("fills in what a range spans and tolerates other connectors", () => {
    expect(parseInitiativeTierRange("Low → High")).toEqual(set("low", "mid", "high"));
    expect(parseInitiativeTierRange("low -> mid")).toEqual(set("low", "mid"));
    expect(parseInitiativeTierRange("Low to Mid")).toEqual(set("low", "mid"));
    expect(parseInitiativeTierRange("  HIGH ")).toEqual(set("high"));
  });

  it("takes a slash list as written", () => {
    expect(parseInitiativeTierRange("Low/High")).toEqual(set("low", "high"));
  });

  it("returns null for blank or unparseable text", () => {
    expect(parseInitiativeTierRange(null)).toBeNull();
    expect(parseInitiativeTierRange(undefined)).toBeNull();
    expect(parseInitiativeTierRange("")).toBeNull();
    expect(parseInitiativeTierRange("Varies")).toBeNull();
    expect(parseInitiativeTierRange("#REF!")).toBeNull();
  });
});

describe("describeTierRange", () => {
  it("reads naturally", () => {
    expect(describeTierRange(set("high"))).toBe("high-priced");
    expect(describeTierRange(set("mid", "low"))).toBe("low- to mid-priced");
  });
});
