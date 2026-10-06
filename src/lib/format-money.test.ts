import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatMoneyPrecise,
  formatMoneyFromMinor,
  formatAxisMoney,
  formatNumber,
} from "./format-money";

/**
 * The bug being locked out: eleven components each abbreviated large figures to
 * "$6.06M", which hides the actual number on cards reporting a revenue target.
 * These assert that user-facing money is always shown in full.
 */
describe("formatMoney", () => {
  it("shows millions in full rather than abbreviating", () => {
    expect(formatMoney(6060000)).toBe("$6,060,000");
  });

  it("shows thousands in full", () => {
    expect(formatMoney(2000)).toBe("$2,000");
  });

  it("never emits an M or K suffix", () => {
    for (const v of [1_000, 999_999, 1_000_000, 7_880_000, 1_234_567_890]) {
      expect(formatMoney(v)).not.toMatch(/[MK]/);
    }
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0");
  });

  it("rounds to whole dollars", () => {
    expect(formatMoney(1234.56)).toBe("$1,235");
    expect(formatMoney(1234.4)).toBe("$1,234");
  });

  it("puts the sign before the symbol for negatives", () => {
    expect(formatMoney(-1500)).toBe("-$1,500");
  });

  // A missing figure must render as $0, not "$NaN" on a revenue card.
  it("treats null and undefined as zero", () => {
    expect(formatMoney(null)).toBe("$0");
    expect(formatMoney(undefined)).toBe("$0");
  });

  it("does not emit NaN for non-finite input", () => {
    expect(formatMoney(NaN)).toBe("$0");
    expect(formatMoney(Infinity)).toBe("$0");
  });

  it("handles billions", () => {
    expect(formatMoney(1234567890)).toBe("$1,234,567,890");
  });
});

describe("formatMoneyPrecise", () => {
  it("keeps cents for recorded amounts", () => {
    expect(formatMoneyPrecise(4497.53)).toBe("$4,497.53");
  });

  it("pads to two decimals", () => {
    expect(formatMoneyPrecise(100)).toBe("$100.00");
  });

  it("formats zero with cents", () => {
    expect(formatMoneyPrecise(0)).toBe("$0.00");
  });

  it("handles negatives", () => {
    expect(formatMoneyPrecise(-348.85)).toBe("-$348.85");
  });

  it("defaults null to zero", () => {
    expect(formatMoneyPrecise(null)).toBe("$0.00");
  });
});

describe("formatMoneyFromMinor", () => {
  // Stripe sends cents; a missing /100 would overstate every invoice 100x.
  it("converts cents to dollars", () => {
    expect(formatMoneyFromMinor(14900)).toBe("$149.00");
  });

  it("formats large minor amounts with separators", () => {
    expect(formatMoneyFromMinor(449753)).toBe("$4,497.53");
  });

  it("formats zero", () => {
    expect(formatMoneyFromMinor(0)).toBe("$0.00");
  });

  it("defaults null to zero", () => {
    expect(formatMoneyFromMinor(null)).toBe("$0.00");
  });

  it("omits the dollar symbol for other currencies", () => {
    expect(formatMoneyFromMinor(14900, "eur")).toBe("149.00");
  });
});

/** The single permitted exception, kept narrow and tested as such. */
describe("formatAxisMoney", () => {
  it("abbreviates millions for axis ticks", () => {
    expect(formatAxisMoney(6060000)).toBe("$6.1M");
  });

  it("drops a pointless trailing zero", () => {
    expect(formatAxisMoney(6000000)).toBe("$6M");
  });

  it("abbreviates thousands", () => {
    expect(formatAxisMoney(45000)).toBe("$45K");
  });

  it("leaves small values intact", () => {
    expect(formatAxisMoney(500)).toBe("$500");
  });

  it("formats zero", () => {
    expect(formatAxisMoney(0)).toBe("$0");
  });

  it("handles negatives", () => {
    expect(formatAxisMoney(-45000)).toBe("-$45K");
  });

  it("defaults null to zero", () => {
    expect(formatAxisMoney(null)).toBe("$0");
  });
});

describe("formatNumber", () => {
  it("adds separators without a currency symbol", () => {
    expect(formatNumber(1000000)).toBe("1,000,000");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("defaults null to zero", () => {
    expect(formatNumber(null)).toBe("0");
  });
});
