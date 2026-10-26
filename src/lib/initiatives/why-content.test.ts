import { describe, it, expect } from "vitest";
import { whySections, WHY_CLAMP_CHARS } from "@/lib/initiatives/why-content";
import type { ContextEntry } from "@/lib/workbook/read";

function entry(over: Partial<ContextEntry> = {}): ContextEntry {
  return {
    initiativeKey: "webinar",
    whenToUse: null,
    bestFit: null,
    minBudget: null,
    minAssets: null,
    whyItWorks: null,
    whatToAvoid: null,
    sequencingNotes: null,
    ...over,
  };
}

describe("whySections", () => {
  it("shows only When to use, even when every other field is filled", () => {
    const out = whySections(
      entry({
        whatToAvoid: "avoid",
        whyItWorks: "works",
        minAssets: "assets",
        bestFit: "fit",
        whenToUse: "when",
        minBudget: "$500",
        sequencingNotes: "after email",
      }),
      "old description"
    );
    expect(out).toEqual([{ heading: "When to use", text: "when", long: false }]);
  });

  it("keeps internal line breaks and trims the ends", () => {
    const out = whySections(entry({ whenToUse: "\n- a list\n- of things\n" }), null);
    expect(out[0].text).toBe("- a list\n- of things");
  });

  it("falls back to the type description when there is no entry", () => {
    expect(whySections(null, "old description")).toEqual([
      { heading: "When to use", text: "old description", long: false },
    ]);
  });

  it("falls back when the entry's When to use is blank, ignoring its other fields", () => {
    const out = whySections(entry({ whenToUse: "  ", bestFit: "fit", whyItWorks: "works" }), " old description ");
    expect(out).toEqual([{ heading: "When to use", text: "old description", long: false }]);
  });

  it("returns nothing (hide the card) when neither source has text", () => {
    expect(whySections(null, "")).toEqual([]);
    expect(whySections(undefined, undefined)).toEqual([]);
    expect(whySections(entry({ bestFit: "fit", whatToAvoid: "avoid" }), "   ")).toEqual([]);
  });

  it("never produces a Sizing Guidance section", () => {
    const withExtra = { ...entry({ whenToUse: "when" }), sizingGuidance: "stale" } as Partial<ContextEntry>;
    expect(whySections(withExtra, "d").some((s) => /sizing/i.test(s.heading))).toBe(false);
  });

  it("marks the text long only above the clamp threshold", () => {
    expect(whySections(entry({ whenToUse: "x".repeat(WHY_CLAMP_CHARS) }), null)[0].long).toBe(false);
    expect(whySections(entry({ whenToUse: "x".repeat(WHY_CLAMP_CHARS + 1) }), null)[0].long).toBe(true);
  });
});
