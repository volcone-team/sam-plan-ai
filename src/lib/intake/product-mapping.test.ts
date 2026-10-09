import { describe, it, expect } from "vitest";
import {
  toRevenueType,
  toTicketTier,
  type RevenueType,
  type TicketTier,
} from "./product-mapping";
import { PRICE_TIER_OPTIONS, PRICING_MODEL_OPTIONS } from "./schema";

/**
 * These tests exist because the mismatch they cover is invisible to the type
 * checker: both sides are strings, so writing 'one_time' into a column that
 * only accepts 'one-time' compiles cleanly and fails only against the real
 * database.
 */

/** The only values `products.revenue_type` accepts (migration 001). */
const ALLOWED_REVENUE_TYPES: RevenueType[] = ["one-time", "recurring"];

/** The only values `products.ticket_tier` accepts (migration 001). */
const ALLOWED_TICKET_TIERS: TicketTier[] = ["low", "mid", "high"];

describe("toRevenueType", () => {
  it("keeps recurring as recurring", () => {
    expect(toRevenueType("recurring")).toBe("recurring");
  });

  it("uses the HYPHENATED one-time the constraint demands", () => {
    // The actual bug: the intake stores 'one_time' with an underscore.
    expect(toRevenueType("one_time")).toBe("one-time");
  });

  it("treats a payment plan as one-time, not recurring", () => {
    // Instalments on a single purchase are not renewing revenue.
    expect(toRevenueType("payment_plan")).toBe("one-time");
  });

  it("falls back to one-time for an unanswered payment type", () => {
    expect(toRevenueType(null)).toBe("one-time");
    expect(toRevenueType(undefined)).toBe("one-time");
    expect(toRevenueType("")).toBe("one-time");
  });

  it("never returns a value the constraint would reject", () => {
    const inputs = [
      "one_time",
      "recurring",
      "payment_plan",
      "ONE_TIME",
      null,
      undefined,
      "",
      0,
      {},
      [],
    ];

    for (const input of inputs) {
      expect(ALLOWED_REVENUE_TYPES).toContain(toRevenueType(input));
    }
  });

  /**
   * The guard that matters most: if someone adds a payment type to the intake,
   * this fails until the mapping handles it, instead of surfacing as a failed
   * build for a customer.
   */
  it("maps every payment type the intake actually offers", () => {
    for (const option of PRICING_MODEL_OPTIONS) {
      expect(ALLOWED_REVENUE_TYPES).toContain(toRevenueType(option.value));
    }
  });
});

describe("toTicketTier", () => {
  it("passes through the three tiers that already match", () => {
    expect(toTicketTier("low")).toBe("low");
    expect(toTicketTier("mid")).toBe("mid");
    expect(toTicketTier("high")).toBe("high");
  });

  it("maps one-on-one to high, which the constraint has no slot for", () => {
    expect(toTicketTier("one_to_one")).toBe("high");
  });

  it("defaults an unanswered price level to mid", () => {
    // NOT NULL, so null cannot be passed through; mid is the column default
    // and does not overstate the catalogue.
    expect(toTicketTier(null)).toBe("mid");
    expect(toTicketTier(undefined)).toBe("mid");
    expect(toTicketTier("")).toBe("mid");
  });

  it("never returns a value the constraint would reject", () => {
    const inputs = ["low", "mid", "high", "one_to_one", "HIGH", null, undefined, "", 5, {}];

    for (const input of inputs) {
      expect(ALLOWED_TICKET_TIERS).toContain(toTicketTier(input));
    }
  });

  it("maps every price tier the intake actually offers", () => {
    for (const option of PRICE_TIER_OPTIONS) {
      expect(ALLOWED_TICKET_TIERS).toContain(toTicketTier(option.value));
    }
  });
});
