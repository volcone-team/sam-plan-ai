import { describe, expect, it } from "vitest";
import { explainRanked, rankForRecommendation } from "@/lib/recommend/shortlist";
import {
  parseExplanations,
  templateExplanation,
  type ParsedExplanation,
} from "@/lib/recommend/explain";
import { scoreInitiative } from "@/lib/recommend/score";
import type { LibraryInitiative } from "@/lib/intake/library";
import type { ContextEntry } from "@/lib/workbook/read";

function initiative(key: string, s: number[], over: Partial<LibraryInitiative> = {}): LibraryInitiative {
  const [speedScore, costScore, oddsScore, revenueScore, easeScore] = s;
  return {
    key,
    name: key,
    category: null,
    oneLiner: null,
    ownOrOps: null,
    priceTier: null,
    difficulty: null,
    speedToResults: null,
    needsSalesTeam: null,
    speedScore,
    costScore,
    oddsScore,
    revenueScore,
    easeScore,
    ...over,
  };
}

// Totals 25, 21, 18, 15, 12, 9, 7 — a clear order.
const POOL = [
  initiative("g", [1, 1, 1, 2, 2]),
  initiative("c", [4, 4, 4, 3, 3]),
  initiative("a", [5, 5, 5, 5, 5]),
  initiative("e", [3, 2, 2, 3, 2]),
  initiative("b", [5, 4, 4, 5, 3]),
  initiative("d", [3, 3, 3, 3, 3]),
  initiative("f", [2, 2, 2, 2, 1]),
];
const ORDER = ["a", "b", "c", "d", "e", "f", "g"];

const CONTEXT = new Map<string, ContextEntry>([
  [
    "b",
    {
      initiativeKey: "b",
      whenToUse: "You already have a proven offer. Other text.",
      bestFit: null,
      minBudget: null,
      minAssets: "A talk that has sold from stage\nA booking calendar",
      whyItWorks: null,
      whatToAvoid: "Pitching too early. Then more.",
      sequencingNotes: null,
    },
  ],
]);

function aiFor(keys: readonly string[]): ParsedExplanation[] {
  return keys.map((key) => ({
    key,
    whyFits: `AI says ${key} fits.`,
    whatToTrack: ["Registrations"],
    watchOutFor: null,
    readinessQuestions: [],
  }));
}

describe("rankForRecommendation", () => {
  it("orders by SCORE and shortlists top N plus the reserve", () => {
    const { ranked, shortlist } = rankForRecommendation(POOL, { revenueWeight: 1, wanted: 3 });
    expect(ranked.map((r) => r.initiative.key)).toEqual(ORDER);
    expect(shortlist.map((r) => r.initiative.key)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("shortlists nothing when nothing is wanted", () => {
    expect(rankForRecommendation(POOL, { revenueWeight: 1, wanted: 0 }).shortlist).toEqual([]);
  });
});

describe("explainRanked", () => {
  const { ranked, shortlist } = rankForRecommendation(POOL, { revenueWeight: 1, wanted: 3 });
  const keys = shortlist.map((s) => s.initiative.key);

  it("gives the same order with and without the AI", () => {
    const withAi = explainRanked(ranked, keys, aiFor(keys), CONTEXT);
    const without = explainRanked(ranked, keys, null, CONTEXT);
    expect(withAi.items.map((i) => i.initiative.key)).toEqual(ORDER);
    expect(without.items.map((i) => i.initiative.key)).toEqual(ORDER);
    expect(without.items.every((i) => i.explanation.source === "template")).toBe(true);
    expect(without.filled).toEqual(keys);
  });

  it("cannot be reordered, added to or shortened by the AI", () => {
    const reversed = aiFor([...keys].reverse());
    const invented = aiFor(["not-a-key", "g"]); // g is ranked but NOT shortlisted
    const result = explainRanked(ranked, keys, [...invented, ...reversed], CONTEXT);
    expect(result.items.map((i) => i.initiative.key)).toEqual(ORDER);
    expect(result.ignored).toEqual(["not-a-key", "g"]);
    // g is past the shortlist: templated even though the model wrote about it.
    expect(result.items.find((i) => i.initiative.key === "g")?.explanation.source).toBe("template");
    expect(result.items.find((i) => i.initiative.key === "a")?.explanation.whyFits).toBe("AI says a fits.");
  });

  it("fills a missing or blank explanation from the template", () => {
    const partial = aiFor(keys.filter((k) => k !== "b"));
    partial[0] = { ...partial[0], whyFits: null }; // "a" blank
    const result = explainRanked(ranked, keys, partial, CONTEXT);
    expect(result.filled).toEqual(["a", "b"]);
    const b = result.items.find((i) => i.initiative.key === "b")!;
    expect(b.explanation).toEqual(templateExplanation(b.initiative, b.score, CONTEXT.get("b")));
    expect(b.explanation.source).toBe("template");
    expect(result.items.find((i) => i.initiative.key === "c")?.explanation.source).toBe("ai");
  });

  it("fills blank AI fields from the template, field by field", () => {
    const ai: ParsedExplanation[] = [
      { key: "b", whyFits: "Fits.", whatToTrack: [], watchOutFor: null, readinessQuestions: [] },
    ];
    const b = explainRanked(ranked, keys, ai, CONTEXT).items.find((i) => i.initiative.key === "b")!;
    expect(b.explanation).toMatchObject({
      whyFits: "Fits.",
      source: "ai",
      watchOutFor: "Pitching too early.",
      readinessQuestions: ["Do you have a talk that has sold from stage?", "Do you have a booking calendar?"],
    });
  });
});

describe("templateExplanation", () => {
  it("speaks from the scores, metrics and AI Context", () => {
    const entry = initiative("b", [5, 4, 4, 5, 3], { metricsRaw: "- Registrations\n- Attendees\n- Sales" });
    const t = templateExplanation(entry, scoreInitiative(entry), CONTEXT.get("b"));
    expect(t.whyFits).toBe(
      "Scores 21 of 25: it produces revenue quickly and has high revenue potential. " +
        "Best when: You already have a proven offer."
    );
    expect(t.whatToTrack.length).toBeGreaterThan(0);
    expect(t.watchOutFor).toBe("Pitching too early.");
  });

  it("flags an incomplete score", () => {
    const entry = initiative("x", [5, 5, 5, 5, 5], { easeScore: null });
    expect(templateExplanation(entry, scoreInitiative(entry), undefined).whyFits).toContain("provisional");
  });
});

describe("parseExplanations", () => {
  it("reads the object, a bare array and a fenced answer", () => {
    const body = '{"explanations":[{"key":"a","whyFits":"Yes.","whatToTrack":["x","x",3],"readinessQuestions":[]}]}';
    for (const raw of [body, `Here you go:\n\`\`\`json\n${body}\n\`\`\``, '[{"key":"a","whyFits":"Yes."}]']) {
      expect(parseExplanations(raw)[0]).toMatchObject({ key: "a", whyFits: "Yes." });
    }
    expect(parseExplanations(body)[0].whatToTrack).toEqual(["x"]);
    expect(parseExplanations("not json")).toEqual([]);
  });
});
