import { describe, it, expect } from "vitest";
import {
  stripFormatting,
  parseNumberInput,
  formatNumberInput,
  formatNumberValue,
  caretPositionAfterFormat,
} from "./number-input";

/**
 * These inputs feed revenue goals and budgets straight into plan generation, so
 * a parsing slip is not cosmetic — "1,000,000" read as 1 would silently generate
 * a plan against the wrong target. The partial-input cases matter just as much:
 * every one of them occurs mid-typing on every keystroke.
 */

describe("stripFormatting", () => {
  it("removes thousands separators", () => {
    expect(stripFormatting("1,000,000")).toBe("1000000");
  });

  it("removes currency symbols and spaces", () => {
    expect(stripFormatting("$ 1,250")).toBe("1250");
  });

  it("returns empty for empty input", () => {
    expect(stripFormatting("")).toBe("");
  });

  it("keeps a single decimal point", () => {
    expect(stripFormatting("1,234.56")).toBe("1234.56");
  });

  it("collapses repeated decimal points so the first wins", () => {
    expect(stripFormatting("1.2.3")).toBe("1.23");
  });

  it("keeps a leading minus", () => {
    expect(stripFormatting("-1,500")).toBe("-1500");
  });

  it("drops a minus that is not leading", () => {
    expect(stripFormatting("1-500")).toBe("1500");
  });

  it("preserves a lone minus so typing a negative is not interrupted", () => {
    expect(stripFormatting("-")).toBe("-");
  });

  it("preserves a trailing decimal point mid-typing", () => {
    expect(stripFormatting("12.")).toBe("12.");
  });

  it("strips letters pasted in from a spreadsheet", () => {
    expect(stripFormatting("1,000 USD")).toBe("1000");
  });
});

describe("parseNumberInput", () => {
  it("parses a formatted number", () => {
    expect(parseNumberInput("1,000,000")).toBe(1000000);
  });

  it("parses a plain number", () => {
    expect(parseNumberInput("750000")).toBe(750000);
  });

  it("parses decimals", () => {
    expect(parseNumberInput("1,234.56")).toBe(1234.56);
  });

  it("parses negatives", () => {
    expect(parseNumberInput("-2,500")).toBe(-2500);
  });

  // null, not 0: the questionnaire stores `number | null` and must tell
  // "unanswered" apart from "answered zero".
  it("returns null for empty input", () => {
    expect(parseNumberInput("")).toBeNull();
  });

  it("returns null for a lone minus", () => {
    expect(parseNumberInput("-")).toBeNull();
  });

  it("returns null for a lone decimal point", () => {
    expect(parseNumberInput(".")).toBeNull();
  });

  it("returns null for text with no digits", () => {
    expect(parseNumberInput("abc")).toBeNull();
  });

  it("preserves an explicit zero", () => {
    expect(parseNumberInput("0")).toBe(0);
  });
});

describe("formatNumberInput", () => {
  it("groups millions", () => {
    expect(formatNumberInput("1000000")).toBe("1,000,000");
  });

  it("groups thousands", () => {
    expect(formatNumberInput("750000")).toBe("750,000");
  });

  it("leaves three digits ungrouped", () => {
    expect(formatNumberInput("999")).toBe("999");
  });

  it("is idempotent on already-formatted input", () => {
    expect(formatNumberInput("1,000,000")).toBe("1,000,000");
  });

  it("returns empty for empty input", () => {
    expect(formatNumberInput("")).toBe("");
  });

  it("groups the integer part only, leaving decimals alone", () => {
    expect(formatNumberInput("1234.5678")).toBe("1,234.5678");
  });

  it("keeps a trailing decimal point so typing can continue", () => {
    expect(formatNumberInput("1000.")).toBe("1,000.");
  });

  it("formats negatives", () => {
    expect(formatNumberInput("-1500")).toBe("-1,500");
  });

  it("passes a lone minus through unchanged", () => {
    expect(formatNumberInput("-")).toBe("-");
  });

  it("does not invent a zero for a bare decimal point", () => {
    expect(formatNumberInput(".")).toBe("");
  });

  it("keeps a single leading zero", () => {
    expect(formatNumberInput("0")).toBe("0");
  });
});

describe("formatNumberValue", () => {
  it("formats a stored number", () => {
    expect(formatNumberValue(1000000)).toBe("1,000,000");
  });

  it("renders null as empty, not as zero", () => {
    expect(formatNumberValue(null)).toBe("");
  });

  it("renders undefined as empty", () => {
    expect(formatNumberValue(undefined)).toBe("");
  });

  it("renders a real zero", () => {
    expect(formatNumberValue(0)).toBe("0");
  });

  it("keeps decimals", () => {
    expect(formatNumberValue(1234.56)).toBe("1,234.56");
  });

  // toLocaleString defaults to 3 decimal places, which would silently round a
  // precise figure on display and then save the rounded value back.
  it("does not round long decimals", () => {
    expect(formatNumberValue(1234.56789)).toBe("1,234.56789");
  });
});

describe("caretPositionAfterFormat", () => {
  it("keeps the caret after the digit just typed", () => {
    // "1000" + "0" typed at the end -> "10,000", caret at the end.
    expect(caretPositionAfterFormat("10,000", 5, "10000")).toBe(6);
  });

  it("accounts for a comma inserted to the left of the caret", () => {
    // Typing the 4th digit turns "100" into "1,000": 4 digits precede the
    // caret, so it must land at index 5, past the inserted comma.
    expect(caretPositionAfterFormat("1,000", 4, "1000")).toBe(5);
  });

  it("holds the caret at the start", () => {
    expect(caretPositionAfterFormat("1,000", 0, "1000")).toBe(0);
  });

  it("positions correctly mid-number", () => {
    // Two digits to the left in "1000" -> after "10" in "1,000" (index 3).
    expect(caretPositionAfterFormat("1,000", 2, "1000")).toBe(3);
  });

  it("clamps to the end when the count exceeds the formatted length", () => {
    expect(caretPositionAfterFormat("999", 10, "999")).toBe(3);
  });
});
