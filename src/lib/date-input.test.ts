import { describe, it, expect } from "vitest";
import { isoToDisplay, displayToIso, formatDateTyping } from "@/components/ui/date-input";

/**
 * These conversions sit between what the user reads (MM/DD/YYYY) and what is
 * stored (ISO YYYY-MM-DD). A slip here silently swaps month and day — and on a
 * comp expiry date that means free access ending on the wrong day, with nothing
 * visibly broken to hint at it.
 */

describe("isoToDisplay", () => {
  it("renders ISO as US order", () => {
    expect(isoToDisplay("2026-10-15")).toBe("10/15/2026");
  });

  // The actual reported bug: day-first rendering by the browser's locale.
  it("does not produce day-first output", () => {
    expect(isoToDisplay("2026-03-04")).toBe("03/04/2026");
    expect(isoToDisplay("2026-03-04")).not.toBe("04/03/2026");
  });

  it("returns empty for an empty value", () => {
    expect(isoToDisplay("")).toBe("");
  });

  it("returns empty for malformed input rather than guessing", () => {
    expect(isoToDisplay("not-a-date")).toBe("");
    expect(isoToDisplay("2026-10")).toBe("");
  });
});

describe("displayToIso", () => {
  it("parses US order into ISO", () => {
    expect(displayToIso("10/15/2026")).toBe("2026-10-15");
  });

  it("accepts digits with no separators", () => {
    expect(displayToIso("10152026")).toBe("2026-10-15");
  });

  it("reads the first pair as the MONTH", () => {
    // 03/04 is March 4th, not April 3rd.
    expect(displayToIso("03/04/2026")).toBe("2026-03-04");
  });

  it("returns empty while the date is incomplete", () => {
    expect(displayToIso("10/1")).toBe("");
    expect(displayToIso("")).toBe("");
  });

  it("rejects an impossible month", () => {
    expect(displayToIso("13/01/2026")).toBe("");
  });

  // Shape-only validation would accept this and store an invalid date.
  it("rejects a day that does not exist in that month", () => {
    expect(displayToIso("02/31/2026")).toBe("");
    expect(displayToIso("04/31/2026")).toBe("");
  });

  it("accepts a valid leap day", () => {
    expect(displayToIso("02/29/2028")).toBe("2028-02-29");
  });

  it("rejects a leap day in a non-leap year", () => {
    expect(displayToIso("02/29/2026")).toBe("");
  });

  it("round-trips with isoToDisplay", () => {
    for (const iso of ["2026-01-01", "2026-12-31", "2028-02-29"]) {
      expect(displayToIso(isoToDisplay(iso))).toBe(iso);
    }
  });
});

describe("formatDateTyping", () => {
  it("inserts slashes as digits are typed", () => {
    expect(formatDateTyping("10")).toBe("10");
    expect(formatDateTyping("1015")).toBe("10/15");
    expect(formatDateTyping("10152026")).toBe("10/15/2026");
  });

  it("is idempotent on already-formatted input", () => {
    expect(formatDateTyping("10/15/2026")).toBe("10/15/2026");
  });

  it("ignores extra digits beyond a full date", () => {
    expect(formatDateTyping("1015202699")).toBe("10/15/2026");
  });

  it("strips letters pasted in", () => {
    expect(formatDateTyping("Oct 15 2026")).toBe("15/20/26");
  });

  it("handles empty input", () => {
    expect(formatDateTyping("")).toBe("");
  });
});
