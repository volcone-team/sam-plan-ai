import { describe, it, expect } from "vitest";
import { intervalFor, intervalSuffix, isMissingIntervalColumn, readInterval, withoutInterval } from "./recurring-interval";

describe("recurring interval", () => {
  it("stores month | year for recurring and null for one-time", () => {
    expect(intervalFor("recurring", "year")).toBe("year");
    expect(intervalFor("recurring", undefined)).toBe("month");
    expect(intervalFor("one-time", "year")).toBeNull();
  });

  it("reads an unrecorded recurring interval as monthly", () => {
    expect(readInterval("recurring", null)).toBe("month");
    expect(readInterval("recurring", "year")).toBe("year");
    expect(readInterval("one-time", "year")).toBeNull();
  });

  it("labels the price", () => {
    expect(intervalSuffix("year")).toBe("/yr");
    expect(intervalSuffix("month")).toBe("/mo");
    expect(intervalSuffix(null)).toBe("/mo");
  });

  it("spots only the missing interval column", () => {
    expect(isMissingIntervalColumn({ code: "PGRST204", message: "Could not find the 'recurring_interval' column of 'products'" })).toBe(true);
    expect(isMissingIntervalColumn({ code: "42703", message: 'column "recurring_interval" does not exist' })).toBe(true);
    expect(isMissingIntervalColumn({ code: "23514", message: "check violation" })).toBe(false);
    expect(isMissingIntervalColumn(null)).toBe(false);
  });

  it("drops the column for a retry", () => {
    expect(withoutInterval({ name: "A", recurring_interval: "year" })).toEqual({ name: "A" });
    expect(withoutInterval({ name: "A" })).toBeNull();
  });
});
