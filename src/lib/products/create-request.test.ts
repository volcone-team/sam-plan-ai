import { describe, it, expect } from "vitest";
import { parseCreateProductRequest } from "./create-request";

describe("parseCreateProductRequest", () => {
  it("accepts the Products page body and trims the name", () => {
    expect(
      parseCreateProductRequest({ name: "  Coaching ", price: 1500, revenueType: "recurring", ticketTier: "high" })
    ).toEqual({
      ok: true,
      value: { name: "Coaching", description: "", price: 1500, revenueType: "recurring", recurringInterval: "month", ticketTier: "high", displayOrder: 0 },
    });
  });

  it("keeps per month / per year for a recurring product, and none for one-time", () => {
    const yearly = parseCreateProductRequest({ name: "A", price: 1, revenueType: "recurring", recurringInterval: "year" });
    expect(yearly.ok && yearly.value.recurringInterval).toBe("year");
    const oneTime = parseCreateProductRequest({ name: "A", price: 1, revenueType: "one-time", recurringInterval: "year" });
    expect(oneTime.ok && oneTime.value.recurringInterval).toBeNull();
    expect(parseCreateProductRequest({ name: "A", price: 1, revenueType: "recurring", recurringInterval: "week" }).ok).toBe(false);
  });
  it("defaults revenue type and tier", () => {
    const r = parseCreateProductRequest({ name: "Course", price: 0 });
    expect(r.ok && r.value).toMatchObject({ revenueType: "one-time", ticketTier: "mid" });
  });

  it("rejects bad input", () => {
    expect(parseCreateProductRequest(null).ok).toBe(false);
    expect(parseCreateProductRequest({ name: " ", price: 1 }).ok).toBe(false);
    expect(parseCreateProductRequest({ name: "A", price: -1 }).ok).toBe(false);
    expect(parseCreateProductRequest({ name: "A", price: "10" }).ok).toBe(false);
    expect(parseCreateProductRequest({ name: "A", price: 1, revenueType: "weekly" }).ok).toBe(false);
    expect(parseCreateProductRequest({ name: "A", price: 1, ticketTier: "vip" }).ok).toBe(false);
  });

  it("ignores a company id in the body", () => {
    const r = parseCreateProductRequest({ name: "A", price: 1, companyId: "other" });
    expect(r.ok && "companyId" in r.value).toBe(false);
  });
});
