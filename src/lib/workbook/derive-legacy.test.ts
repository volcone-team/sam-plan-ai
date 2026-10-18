import { describe, it, expect } from "vitest";
import { deriveLegacyFields, parseWorkbook, type RawSheet } from "@/lib/workbook/parse";

type Input = Parameters<typeof deriveLegacyFields>[0];
const row = (over: Partial<Input>): Input => ({
  difficulty: null, speedToResults: null, speedScore: null, easeScore: null, ...over,
});

describe("deriveLegacyFields", () => {
  it("derives difficulty = 6 - ease and speed from the speed score", () => {
    expect(deriveLegacyFields(row({ easeScore: 4, speedScore: 5 })))
      .toMatchObject({ difficulty: 2, speedToResults: "Fast" });
    expect(deriveLegacyFields(row({ easeScore: 1, speedScore: 3 })))
      .toMatchObject({ difficulty: 5, speedToResults: "Medium" });
    expect(deriveLegacyFields(row({ easeScore: 5, speedScore: 1 })))
      .toMatchObject({ difficulty: 1, speedToResults: "Slow" });
  });

  // Exhaustive over the whole input space (each score 1-5 or null), so this
  // is the property, not a sample of it.
  it("holds for every score combination", () => {
    const values = [null, 1, 2, 3, 4, 5] as const;
    for (const ease of values) {
      for (const speed of values) {
        const out = deriveLegacyFields(row({ easeScore: ease, speedScore: speed }));
        if (ease === null) expect(out.difficulty).toBeNull();
        else {
          expect(out.difficulty).toBe(6 - ease);
          expect(out.difficulty).toBeGreaterThanOrEqual(1);
          expect(out.difficulty).toBeLessThanOrEqual(5);
        }
        const expected = speed === null ? null : speed >= 4 ? "Fast" : speed === 3 ? "Medium" : "Slow";
        expect(out.speedToResults).toBe(expected);
        // Easier never reads as harder, faster never as slower.
        if (ease !== null && ease < 5) {
          const easier = deriveLegacyFields(row({ easeScore: ease + 1 }));
          expect(easier.difficulty!).toBeLessThan(out.difficulty!);
        }
      }
    }
  });

  it("never overwrites values the sheet provided", () => {
    const authored = row({ difficulty: 4, speedToResults: "Slow", easeScore: 5, speedScore: 5 });
    expect(deriveLegacyFields(authored)).toEqual(authored);
  });

  it("fills a blank text speed", () => {
    expect(deriveLegacyFields(row({ speedToResults: "  ", speedScore: 4 })).speedToResults).toBe("Fast");
  });

  it("produces the strings rankHeuristically matches on", () => {
    for (const s of [1, 2, 3, 4, 5]) {
      expect(["fast", "medium", "slow"]).toContain(
        deriveLegacyFields(row({ speedScore: s })).speedToResults!.toLowerCase()
      );
    }
  });

  it("returns the same object when there is nothing to derive", () => {
    const r = row({});
    expect(deriveLegacyFields(r)).toBe(r);
  });
});

describe("parser exposes baseKey on variants only", () => {
  const HEADERS = [
    "ID", "Initiative Name", "Category", "Training", "Metrics", "One-line description",
    "Longer Description", "Do you need a sales team?", "Primary product price tier",
    "Own / Ops (future)", "Ideal Industries", "Call to Action Options",
    "Speed (S)", "Cost (C)", "Odds (O)", "Revenue (R)", "Ease (E)", "SCORE total",
  ];
  const r = (id: string, name: string, own: string): string[] =>
    [id, name, "Webinars", "", "", "x", "y", "NO", "Mid", own, "", "", "3", "3", "3", "3", "3", "15"];
  const sheet: RawSheet = {
    name: "1. Initiative Library", headers: HEADERS,
    rows: [r("IN01", "Live Webinar", "OPS"), r("IN01", "Live Webinar", "OWN"), r("IN02", "Email Campaign", "OWN")],
  };
  const p = parseWorkbook([sheet]);
  const byKey = new Map(p.library.map((l) => [l.initiativeKey, l]));

  it("links the variant to its base", () => {
    expect(byKey.get("webinar-own")?.baseKey).toBe("webinar");
  });

  it("leaves base listings without one", () => {
    expect(byKey.get("webinar")?.baseKey ?? null).toBeNull();
    expect(byKey.get("email-campaign")?.baseKey ?? null).toBeNull();
  });
});
