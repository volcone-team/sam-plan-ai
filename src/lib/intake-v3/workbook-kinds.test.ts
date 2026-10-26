import { describe, it, expect } from "vitest";
import {
  mentionsEvergreen,
  parseWorkbookFrequencies,
  parseWorkbookKinds,
} from "./workbook-kinds";
import { INITIATIVE_KINDS, RECURRENCE_FREQUENCIES } from "./library-config";

/** Every non-empty subset, each also with its first word repeated: exhaustive over small vocabularies. */
function nonEmptySubsetsWithRepeats(words: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 1; mask < 1 << words.length; mask++) {
    const picked = words.filter((_, i) => mask & (1 << i));
    out.push(picked, [...picked, picked[0]]);
  }
  return out;
}

const codes = (r: { warnings: readonly { code: string }[] }) => r.warnings.map((w) => w.code);

describe("parseWorkbookKinds — every distinct Frequency value in the client's workbook", () => {
  it.each([
    ["Once, Recurring", ["one-time", "recurring"], []],
    ["Once, Recurring, Evergreen", ["one-time", "recurring", "ongoing"], []],
    ["Once,Recurring, Evergreen", ["one-time", "recurring", "ongoing"], []],
    ["Evergreen", ["ongoing"], []],
    ["Once", ["one-time"], []],
    ["Recurring", ["recurring"], []],
    ["Limited series, Recurring", ["recurring"], ["limited_series_as_recurring"]],
    ["Limited Series, Recurring", ["recurring"], ["limited_series_as_recurring"]],
  ])("%j", (raw, kinds, warningCodes) => {
    const r = parseWorkbookKinds(raw);
    expect(r.kinds).toEqual(kinds);
    expect(codes(r)).toEqual(warningCodes);
  });
});

describe("parseWorkbookKinds — edges", () => {
  it("blank is null (unset), never []", () => {
    for (const raw of [null, undefined, "", "   ", " , ;"]) expect(parseWorkbookKinds(raw).kinds).toBeNull();
  });

  it("warns about and ignores an unknown token; only unknowns is null", () => {
    const r = parseWorkbookKinds("Once, Sometimes");
    expect(r.kinds).toEqual(["one-time"]);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "unknown_kind_token", value: "Sometimes" })]);
    expect(parseWorkbookKinds("Sometimes").kinds).toBeNull();
  });

  it("splits on semicolons and newlines, any case, deduped, canonical order", () => {
    expect(parseWorkbookKinds("EVERGREEN; once\nrecurring, Once").kinds).toEqual(["one-time", "recurring", "ongoing"]);
  });

  /** Order and duplicates in the cell never change the result. */
  it("is order- and duplicate-insensitive (exhaustive)", () => {
    const words = ["Once", "Recurring", "Evergreen", "once", "RECURRING"];
    for (const picked of nonEmptySubsetsWithRepeats(words)) {
      const a = parseWorkbookKinds(picked.join(", ")).kinds;
      const b = parseWorkbookKinds([...picked].reverse().concat(picked).join("; ")).kinds;
      expect(a).toEqual(b);
      expect(a).toEqual(INITIATIVE_KINDS.filter((k) => a!.includes(k)));
    }
  });

  it("detects evergreen in the raw cell", () => {
    expect(mentionsEvergreen("Once,Recurring, Evergreen")).toBe(true);
    expect(mentionsEvergreen("Once, Recurring")).toBe(false);
    expect(mentionsEvergreen(null)).toBe(false);
  });
});

describe("parseWorkbookFrequencies — every distinct token in the client's workbook", () => {
  it.each([
    ["Bi-weekly", ["bi-weekly"]],
    ["Monthly", ["monthly"]],
    ["Bi-monthly", ["bi-monthly"]],
    ["Quarterly", ["quarterly"]],
    ["Semi-annually", ["semi-annually"]],
    ["Semi-Annually", ["semi-annually"]],
    ["Annually", ["annually"]],
    ["Weekly", ["weekly"]],
  ])("%j", (raw, frequencies) => {
    const r = parseWorkbookFrequencies(raw);
    expect(r.frequencies).toEqual(frequencies);
    expect(r.warnings).toEqual([]);
  });

  it("parses a real comma list into canonical order", () => {
    expect(
      parseWorkbookFrequencies("Quarterly, Semi-Annually, Annually, Weekly, Bi-weekly, Monthly, Bi-monthly").frequencies
    ).toEqual([...RECURRENCE_FREQUENCIES]);
    expect(parseWorkbookFrequencies("Monthly, Quarterly, Semi-annually").frequencies)
      .toEqual(["monthly", "quarterly", "semi-annually"]);
  });

  it('"n/a" is explicitly none: []', () => {
    for (const raw of ["n/a", "N/A", "na", "None"]) {
      const r = parseWorkbookFrequencies(raw);
      expect(r.frequencies).toEqual([]);
      expect(r.warnings).toEqual([]);
    }
  });

  it('"Seasonal" is ignored with seasonal_ignored', () => {
    const r = parseWorkbookFrequencies("Seasonal");
    expect(r.frequencies).toBeNull();
    expect(codes(r)).toEqual(["seasonal_ignored"]);
    expect(parseWorkbookFrequencies("Seasonal, Annually").frequencies).toEqual(["annually"]);
  });

  it("blank is null (unset)", () => {
    for (const raw of [null, undefined, "", "  "]) expect(parseWorkbookFrequencies(raw).frequencies).toBeNull();
  });

  it("accepts the spelling variants", () => {
    expect(parseWorkbookFrequencies("biweekly; bimonthly; semiannually; semi-annual; annual; yearly").frequencies)
      .toEqual(["bi-weekly", "bi-monthly", "semi-annually", "annually"]);
  });

  it("warns about and ignores an unknown token", () => {
    const r = parseWorkbookFrequencies("Monthly, Daily");
    expect(r.frequencies).toEqual(["monthly"]);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "unknown_frequency_token", value: "Daily" })]);
  });

  /** Any shuffle of known tokens gives the same canonical, duplicate-free list. */
  it("is order- and duplicate-insensitive (exhaustive)", () => {
    const words = ["Weekly", "Bi-weekly", "Monthly", "Bi-monthly", "Quarterly", "Semi-annually", "Semi-Annually", "Annually"];
    for (const picked of nonEmptySubsetsWithRepeats(words)) {
      const a = parseWorkbookFrequencies(picked.join(", ")).frequencies!;
      const b = parseWorkbookFrequencies([...picked].reverse().concat(picked).join(";")).frequencies;
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(a.length);
      expect(a).toEqual(RECURRENCE_FREQUENCIES.filter((f) => a.includes(f)));
    }
  });
});
