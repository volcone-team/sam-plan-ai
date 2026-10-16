import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieve = vi.fn();
const create = vi.fn();

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ coupons: { retrieve, create } }),
}));

import {
  ensureRetentionCoupon,
  isMissingResource,
  retentionCouponName,
  STRIPE_COUPON_NAME_MAX,
} from "./retention-coupon";
import { DISCOUNT_OFFERS, discountOffer } from "./cancellation";

describe("retentionCouponName", () => {
  it("fits Stripe's 40-character limit for every offer", () => {
    for (const offer of DISCOUNT_OFFERS) {
      expect(retentionCouponName(offer).length).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX);
    }
  });

  it("names the 50% offer in full", () => {
    expect(retentionCouponName(discountOffer("half_off_two_months")!)).toBe(
      "SAM retention — 50% off for 2 months"
    );
  });

  it("clamps an over-long title rather than producing a name Stripe rejects", () => {
    const name = retentionCouponName({ title: "x".repeat(100) });
    expect(name.length).toBe(STRIPE_COUPON_NAME_MAX);
  });
});

describe("isMissingResource", () => {
  it("treats only resource_missing / 404 as missing", () => {
    expect(isMissingResource({ code: "resource_missing" })).toBe(true);
    expect(isMissingResource({ statusCode: 404 })).toBe(true);
    expect(
      isMissingResource({ type: "StripeInvalidRequestError", statusCode: 400, code: "parameter_invalid_string_too_long" })
    ).toBe(false);
    expect(isMissingResource(new Error("network"))).toBe(false);
  });
});

describe("ensureRetentionCoupon", () => {
  beforeEach(() => {
    retrieve.mockReset();
    create.mockReset();
  });

  it("creates a missing coupon with a short name and the offer's terms", async () => {
    const offer = discountOffer("half_off_two_months")!;
    retrieve.mockRejectedValue(
      Object.assign(new Error(`No such coupon: '${offer.couponId}'`), {
        code: "resource_missing",
        statusCode: 404,
      })
    );
    create.mockImplementation(async (params: { id: string }) => ({ id: params.id }));

    await ensureRetentionCoupon(offer);

    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.id).toBe(offer.couponId);
    expect(params.name.length).toBeLessThanOrEqual(STRIPE_COUPON_NAME_MAX);
    expect(params.percent_off).toBe(offer.percentOff);
    expect(params.duration).toBe("repeating");
    expect(params.duration_in_months).toBe(offer.durationInMonths);
  });

  it("returns an existing coupon untouched, whatever its name", async () => {
    const offer = discountOffer("free_month")!;
    const existing = { id: offer.couponId, name: "SAM Plan AI retention — Next month free" };
    retrieve.mockResolvedValue(existing);

    await expect(ensureRetentionCoupon(offer)).resolves.toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it("rethrows a non-missing Stripe error instead of trying to create", async () => {
    retrieve.mockRejectedValue(
      Object.assign(new Error("Invalid API key"), { type: "StripeAuthenticationError", statusCode: 401 })
    );
    await expect(ensureRetentionCoupon(discountOffer("free_month")!)).rejects.toThrow("Invalid API key");
    expect(create).not.toHaveBeenCalled();
  });
});
