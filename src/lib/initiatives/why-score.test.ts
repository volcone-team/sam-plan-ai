import { describe, it, expect } from "vitest";
import { aiContextResponse, whyScore } from "@/lib/initiatives/why-score";
import { NEUTRAL_SCORE } from "@/lib/recommend/score";
import type { ContextEntry, LibraryScores } from "@/lib/workbook/read";

function scores(over: Partial<LibraryScores> = {}): LibraryScores {
  return {
    speedScore: null,
    costScore: null,
    oddsScore: null,
    revenueScore: null,
    easeScore: null,
    scoreTotal: null,
    ...over,
  };
}

const full = scores({ speedScore: 5, costScore: 4, oddsScore: 3, revenueScore: 2, easeScore: 1, scoreTotal: 15 });

describe("whyScore", () => {
  it("maps a fully scored row to a complete score out of 25", () => {
    expect(whyScore(full)).toEqual({
      total: 15,
      max: 25,
      breakdown: { S: 5, C: 4, O: 3, R: 2, E: 1 },
      complete: true,
      missing: [],
    });
  });

  it("recomputes the total and ignores a stale stored score_total", () => {
    expect(whyScore({ ...full, scoreTotal: 24 })?.total).toBe(15);
  });

  it("marks partial scores provisional, counting each blank as the neutral score", () => {
    const out = whyScore(scores({ speedScore: 5, revenueScore: 4, easeScore: 2 }));
    expect(out).toMatchObject({
      complete: false,
      missing: ["C", "O"],
      breakdown: { S: 5, C: NEUTRAL_SCORE, O: NEUTRAL_SCORE, R: 4, E: 2 },
      total: 5 + 4 + 2 + 2 * NEUTRAL_SCORE,
    });
  });

  it("treats out-of-range and fractional values as missing", () => {
    const out = whyScore(scores({ speedScore: 0, costScore: 6, oddsScore: 2.5, revenueScore: 4 }));
    expect(out?.missing).toEqual(["S", "C", "O", "E"]);
  });

  it("hides the card (null) with no row or no usable score", () => {
    expect(whyScore(null)).toBeNull();
    expect(whyScore(undefined)).toBeNull();
    expect(whyScore(scores())).toBeNull();
    expect(whyScore(scores({ speedScore: 9, scoreTotal: 20 }))).toBeNull();
  });

  it("for every combination of blank, invalid and 1-5 cells: total = breakdown sum, 5-25, provisional iff any missing", () => {
    const cells: Array<number | null> = [null, 0, 1, 2, 5, 6];
    for (const s of cells) for (const c of cells) for (const o of cells) for (const r of cells) for (const e of cells) {
      const out = whyScore(scores({ speedScore: s, costScore: c, oddsScore: o, revenueScore: r, easeScore: e }));
      const valid = [s, c, o, r, e].filter((v) => v !== null && v >= 1 && v <= 5).length;
      if (valid === 0) {
        expect(out).toBeNull();
        continue;
      }
      const b = out!.breakdown;
      expect(out!.total).toBe(b.S + b.C + b.O + b.R + b.E);
      expect(out!.total).toBeGreaterThanOrEqual(5);
      expect(out!.total).toBeLessThanOrEqual(25);
      expect(out!.complete).toBe(valid === 5);
      expect(out!.missing).toHaveLength(5 - valid);
    }
  });
});

describe("aiContextResponse", () => {
  const entry: ContextEntry = {
    initiativeKey: "webinar",
    whenToUse: "when",
    bestFit: null,
    minBudget: null,
    minAssets: null,
    whyItWorks: null,
    whatToAvoid: null,
    sequencingNotes: null,
  };

  it("always carries both fields", () => {
    expect(aiContextResponse(null, null)).toEqual({ entry: null, score: null });
    expect(aiContextResponse(undefined, undefined)).toEqual({ entry: null, score: null });
  });

  it("returns the entry and the mapped score side by side", () => {
    const out = aiContextResponse(entry, full);
    expect(out.entry).toBe(entry);
    expect(out.score?.total).toBe(15);
  });
});
