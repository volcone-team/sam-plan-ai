import { describe, expect, it } from "vitest";
import {
  NEUTRAL_SCORE,
  normaliseRevenueWeight,
  parseRevenueWeight,
  rankByScore,
  scoreAndRank,
  scoreInitiative,
  type ScoreInput,
} from "@/lib/recommend/score";

type Row = ScoreInput & { key: string };

function row(key: string, s: (number | null)[], name = key): Row {
  const [speedScore, costScore, oddsScore, revenueScore, easeScore] = s;
  return { key, name, speedScore, costScore, oddsScore, revenueScore, easeScore };
}

// The workbook's real values (Oct 2026), from the methodology doc's calibration.
const OPS_IN_PERSON = row("ops-in-person", [5, 4, 4, 5, 3], "OPS In Person");
const YOUR_OWN_EVENT = row("your-own-event", [1, 1, 3, 5, 2], "Your Own Event");

describe("scoreInitiative", () => {
  it("matches the doc's calibration examples", () => {
    expect(scoreInitiative(OPS_IN_PERSON).total).toBe(21);
    expect(scoreInitiative(YOUR_OWN_EVENT).total).toBe(12);
    expect(scoreInitiative(OPS_IN_PERSON, { revenueWeight: 2 })).toMatchObject({
      total: 21,
      weightedTotal: 26,
      max: 25,
      weightedMax: 30,
      complete: true,
      breakdown: { S: 5, C: 4, O: 4, R: 5, E: 3 },
    });
  });

  it("counts a missing score as neutral and flags it", () => {
    const score = scoreInitiative(row("x", [5, null, 4, 0, 3]));
    expect(score.complete).toBe(false);
    expect(score.missing).toEqual(["C", "R"]);
    expect(score.breakdown.C).toBe(NEUTRAL_SCORE);
    expect(score.total).toBe(5 + 3 + 4 + 3 + 3);
  });

  it("ignores the stored total and recomputes", () => {
    expect(scoreInitiative({ ...OPS_IN_PERSON, scoreTotal: 99 } as Row).total).toBe(21);
  });
});

describe("normaliseRevenueWeight", () => {
  it("accepts 1-3 in half steps and defaults everything else to 1", () => {
    expect(normaliseRevenueWeight(2)).toBe(2);
    expect(normaliseRevenueWeight("1.5")).toBe(1.5);
    expect(normaliseRevenueWeight(2.2)).toBe(2);
    for (const bad of [null, undefined, NaN, 0, 0.5, 3.5, "x", ""]) {
      expect(normaliseRevenueWeight(bad)).toBe(1);
    }
  });
});

describe("parseRevenueWeight", () => {
  it("accepts only 1-3 in half steps, without snapping", () => {
    expect([1, 1.5, 2, 3].map(parseRevenueWeight)).toEqual([1, 1.5, 2, 3]);
    for (const bad of [0.5, 2.2, 3.5, "2", null, NaN]) expect(parseRevenueWeight(bad)).toBeNull();
  });
});

describe("rankByScore", () => {
  it("ranks OPS In Person above Your Own Event at weight 1 and 2", () => {
    for (const revenueWeight of [1, 2]) {
      const keys = rankByScore([YOUR_OWN_EVENT, OPS_IN_PERSON], { revenueWeight }).map((r) => r.key);
      expect(keys).toEqual(["ops-in-person", "your-own-event"]);
    }
  });

  it("breaks ties on Odds, then Revenue, then Ease, then name", () => {
    // All total 15.
    const odds = row("odds", [3, 3, 5, 2, 2]);
    const revenue = row("revenue", [3, 3, 4, 3, 2]);
    const ease = row("ease", [3, 2, 4, 2, 4]);
    const nameB = row("b", [3, 3, 4, 2, 3], "Bravo");
    const nameA = row("a", [3, 3, 4, 2, 3], "alpha");
    const ranked = rankByScore([nameB, ease, nameA, revenue, odds]).map((r) => r.key);
    expect(ranked).toEqual(["odds", "revenue", "ease", "a", "b"]);
  });

  it("puts a complete row before an incomplete one on an equal total", () => {
    const guessed = row("guessed", [5, 5, null, 5, 5]); // 23 with neutral O
    const measured = row("measured", [5, 5, 3, 5, 5]); // 23
    expect(rankByScore([guessed, measured]).map((r) => r.key)).toEqual(["measured", "guessed"]);
  });

  it("weight 2 reorders only where Revenue differs", () => {
    const highR = row("high-r", [2, 2, 2, 5, 2]); // 13 -> 18
    const lowR = row("low-r", [4, 4, 4, 1, 1]); // 14 -> 15
    expect(rankByScore([highR, lowR], { revenueWeight: 1 }).map((r) => r.key)).toEqual(["low-r", "high-r"]);
    expect(rankByScore([highR, lowR], { revenueWeight: 2 }).map((r) => r.key)).toEqual(["high-r", "low-r"]);
  });

  it("attaches 1-based ranks and does not mutate the input", () => {
    const input = [YOUR_OWN_EVENT, OPS_IN_PERSON];
    const ranked = scoreAndRank(input);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    expect(input[0]).toBe(YOUR_OWN_EVENT);
  });
});

/* ------------------------------------------------------------------ *
 * Seeded properties
 * ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRows(rand: () => number): Row[] {
  const n = Math.floor(rand() * 25);
  const pickScore = () => (rand() < 0.1 ? null : 1 + Math.floor(rand() * 5));
  // Few distinct names so name ties (resolved by key) happen.
  const names = ["Webinar", "webinar", "Podcast", "Referral", "Ads"];
  return Array.from({ length: n }, (_, i) =>
    row(`k${i}`, [pickScore(), pickScore(), pickScore(), pickScore(), pickScore()], names[Math.floor(rand() * names.length)])
  );
}

function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("properties (seeded)", () => {
  it("the order is deterministic whatever order rows arrive in", () => {
    const rand = mulberry32(41);
    for (let run = 0; run < 300; run++) {
      const rows = randomRows(rand);
      const weight = [1, 1.5, 2, 3][Math.floor(rand() * 4)];
      const a = rankByScore(rows, { revenueWeight: weight }).map((r) => r.key);
      const b = rankByScore(shuffled(rows, rand), { revenueWeight: weight }).map((r) => r.key);
      expect(b).toEqual(a);
    }
  });

  it("total is the sum of the breakdown and weighted total adds (w-1) x R", () => {
    const rand = mulberry32(7);
    for (let run = 0; run < 300; run++) {
      for (const r of randomRows(rand)) {
        const weight = [1, 1.5, 2, 2.5, 3][Math.floor(rand() * 5)];
        const score = scoreInitiative(r, { revenueWeight: weight });
        const { S, C, O, R, E } = score.breakdown;
        expect(score.total).toBe(S + C + O + R + E);
        expect(score.weightedTotal).toBe(score.total + (weight - 1) * R);
        expect(score.complete).toBe(score.missing.length === 0);
      }
    }
  });

  it("weight 2 keeps the relative order of any two rows with equal Revenue", () => {
    const rand = mulberry32(99);
    for (let run = 0; run < 200; run++) {
      const rows = randomRows(rand);
      const pos1 = new Map(rankByScore(rows, { revenueWeight: 1 }).map((r, i) => [r.key, i]));
      const pos2 = new Map(rankByScore(rows, { revenueWeight: 2 }).map((r, i) => [r.key, i]));
      for (const a of rows) {
        for (const b of rows) {
          if (a === b) continue;
          if (scoreInitiative(a).breakdown.R !== scoreInitiative(b).breakdown.R) continue;
          expect(pos1.get(a.key)! < pos1.get(b.key)!).toBe(pos2.get(a.key)! < pos2.get(b.key)!);
        }
      }
    }
  });
});
