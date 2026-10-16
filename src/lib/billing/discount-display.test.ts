import { describe, it, expect } from "vitest";
import {
  describeActiveDiscount,
  formatMinor,
  couponIdFromDiscount,
} from "./discount-display";

const base = {
  couponId: "sam_retention_half_off_2mo",
  percentOff: 50,
  amountOff: null,
  duration: "repeating",
  durationInMonths: 2,
  nextChargeMinor: 7450,
  standardChargeMinor: 14900,
  currency: "gbp",
  billingCycle: "monthly",
};

describe("formatMinor", () => {
  it("drops decimals on whole amounts and keeps them otherwise", () => {
    expect(formatMinor(14900, "gbp")).toBe("£149");
    expect(formatMinor(7450, "gbp")).toBe("£74.50");
  });

  it("knows the currencies the product supports", () => {
    expect(formatMinor(4900, "usd")).toBe("$49");
    expect(formatMinor(4900, "eur")).toBe("€49");
    expect(formatMinor(4900, "cad")).toBe("CA$49");
    expect(formatMinor(4900, "aud")).toBe("A$49");
  });

  it("defaults to no symbol for an unknown currency rather than guessing", () => {
    expect(formatMinor(4900, "zar")).toBe("49");
  });

  it("returns null for a missing amount", () => {
    expect(formatMinor(null, "gbp")).toBeNull();
    expect(formatMinor(Number.NaN, "gbp")).toBeNull();
  });
});

describe("describeActiveDiscount", () => {
  /** THE NUMBER THAT WAS MISSING from the panel entirely. */
  it("reports the real next charge, the promise, and what follows", () => {
    expect(describeActiveDiscount(base)).toEqual({
      couponId: "sam_retention_half_off_2mo",
      nextCharge: "£74.50",
      summary: "50% off for 2 months",
      afterwards: "then £149/mo",
      saving: "£74.50",
    });
  });

  it("says nothing at all when no discount is active", () => {
    expect(describeActiveDiscount(null)).toBeNull();
    expect(describeActiveDiscount(undefined)).toBeNull();
    expect(
      describeActiveDiscount({ ...base, percentOff: null, amountOff: null })
    ).toBeNull();
    expect(describeActiveDiscount({ ...base, percentOff: 0, amountOff: 0 })).toBeNull();
  });

  describe("wording per coupon shape", () => {
    it("calls a full discount free rather than '100% off'", () => {
      expect(
        describeActiveDiscount({ ...base, percentOff: 100, duration: "once" })?.summary
      ).toBe("Free on your next payment");
    });

    /**
     * A month off an annual plan is 8.33%. "8.33% off" is technically true and
     * completely unhelpful, but it must not be rounded to something false
     * either — so the figure is kept and trimmed, not reworded.
     */
    it("keeps an awkward percentage honest rather than rounding it away", () => {
      expect(
        describeActiveDiscount({ ...base, percentOff: 8.33, duration: "once" })?.summary
      ).toBe("8.33% off on your next payment");
    });

    it("describes a fixed amount off", () => {
      expect(
        describeActiveDiscount({
          ...base,
          percentOff: null,
          amountOff: 5000,
          duration: "once",
        })?.summary
      ).toBe("£50 off on your next payment");
    });

    it("pluralises the month count", () => {
      expect(
        describeActiveDiscount({ ...base, durationInMonths: 1 })?.summary
      ).toBe("50% off for 1 month");
      expect(
        describeActiveDiscount({ ...base, durationInMonths: 3 })?.summary
      ).toBe("50% off for 3 months");
    });

    /**
     * 'once' is described as a PAYMENT, not a month: on an annual plan a single
     * invoice covers a year, so "for 1 month" would be a false promise.
     */
    it("describes a one-off as a payment, not a month", () => {
      expect(
        describeActiveDiscount({ ...base, duration: "once", durationInMonths: null })?.summary
      ).toBe("50% off on your next payment");
    });

    it("never promises an end date for a forever coupon", () => {
      const forever = describeActiveDiscount({ ...base, duration: "forever" });
      expect(forever?.summary).toBe("50% off, for as long as you subscribe");
      expect(forever?.afterwards).toBeNull();
    });
  });

  describe("annual plans", () => {
    it("uses /yr for the follow-on price", () => {
      expect(
        describeActiveDiscount({
          ...base,
          billingCycle: "annual",
          nextChargeMinor: 136588,
          standardChargeMinor: 149000,
        })?.afterwards
      ).toBe("then £1,490/yr");
    });
  });

  describe("missing figures", () => {
    /**
     * A cancelled subscription has no upcoming invoice to preview. The promise
     * is still describable; the amount is not, and must not be invented.
     */
    it("describes the discount without a charge when the preview is unavailable", () => {
      const result = describeActiveDiscount({
        ...base,
        nextChargeMinor: null,
      });
      expect(result?.summary).toBe("50% off for 2 months");
      expect(result?.nextCharge).toBeNull();
      expect(result?.saving).toBeNull();
    });

    it("omits the saving rather than claiming a negative one", () => {
      expect(
        describeActiveDiscount({
          ...base,
          nextChargeMinor: 14900,
          standardChargeMinor: 14900,
        })?.saving
      ).toBeNull();
    });

    it("omits the follow-on price when the standard price is unknown", () => {
      expect(
        describeActiveDiscount({ ...base, standardChargeMinor: null })?.afterwards
      ).toBeNull();
    });
  });
});

describe("couponIdFromDiscount", () => {
  /**
   * THE SHAPE THIS ACCOUNT ACTUALLY RETURNS, on API version
   * 2026-08-26.dahlia. There is no `coupon` object — only `source.coupon` as a
   * string id — so reading `discount.coupon` found nothing and the panel
   * silently showed no discount at all.
   */
  it("reads the current source.coupon shape", () => {
    expect(
      couponIdFromDiscount({
        id: "di_1UPqZZKVTaV8zOJECmn1KhPG",
        object: "discount",
        promotion_code: null,
        source: { coupon: "sam_retention_annual_month_free", type: "coupon" },
      })
    ).toBe("sam_retention_annual_month_free");
  });

  it("reads an expanded coupon object under source", () => {
    expect(
      couponIdFromDiscount({ source: { coupon: { id: "sam_half_off", percent_off: 50 } } })
    ).toBe("sam_half_off");
  });

  /** Older API versions nest the coupon directly. */
  it("reads the legacy nested coupon object", () => {
    expect(couponIdFromDiscount({ coupon: { id: "sam_legacy", percent_off: 50 } })).toBe(
      "sam_legacy"
    );
  });

  it("reads a legacy bare coupon id", () => {
    expect(couponIdFromDiscount({ coupon: "sam_legacy_string" })).toBe("sam_legacy_string");
  });

  it("prefers source over the legacy field when both are present", () => {
    expect(
      couponIdFromDiscount({
        source: { coupon: "sam_current" },
        coupon: { id: "sam_stale" },
      })
    ).toBe("sam_current");
  });

  it("returns null for anything it cannot read, rather than guessing", () => {
    for (const value of [
      null,
      undefined,
      "di_123",
      42,
      {},
      { source: null },
      { source: {} },
      { source: { coupon: null } },
      { source: { coupon: "" } },
      { coupon: {} },
      { promotion_code: "promo_123" },
    ]) {
      expect(couponIdFromDiscount(value), JSON.stringify(value)).toBeNull();
    }
  });
});
