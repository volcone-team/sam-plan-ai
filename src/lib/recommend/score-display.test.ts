import { describe, expect, it } from "vitest";
import {
  barLabel,
  browseScoreLabel,
  formatTotal,
  formatWeight,
  provisionalNote,
  rankLabel,
  weightedMaxFor,
  weightedTotalLabel,
} from "./score-display";

describe("score-display", () => {
  it("weighted max is 20 + 5 x weight", () => {
    expect(weightedMaxFor(1)).toBe(25);
    expect(weightedMaxFor(1.5)).toBe(27.5);
    expect(weightedMaxFor(2)).toBe(30);
    expect(weightedMaxFor(3)).toBe(35);
  });

  it("formats totals and weights", () => {
    expect(formatTotal(21)).toBe("21 / 25");
    expect(formatWeight(2)).toBe("×2");
    expect(formatWeight(1.5)).toBe("×1.5");
  });

  it("states the weighted total only when the weight is not 1", () => {
    expect(weightedTotalLabel(21, 1)).toBeNull();
    expect(weightedTotalLabel(26, 2)).toBe("26 / 30 with Revenue weighted ×2");
    expect(weightedTotalLabel(23.5, 1.5)).toBe("23.5 / 27.5 with Revenue weighted ×1.5");
  });

  it("labels each bar as text", () => {
    expect(barLabel("S", 5)).toBe("Speed 5 of 5");
    expect(barLabel("O", 3, true)).toBe("Odds 3 of 5 (not scored yet, counted as 3)");
  });

  it("names the missing letters, in S/C/O/R/E order", () => {
    expect(provisionalNote([])).toBeNull();
    expect(provisionalNote(["R"])).toBe("Revenue isn't scored yet, so it was counted as 3.");
    expect(provisionalNote(["O", "S"])).toBe("Speed and Odds aren't scored yet, so each was counted as 3.");
    expect(provisionalNote(["E", "C", "S"])).toBe(
      "Speed, Cost and Ease aren't scored yet, so each was counted as 3."
    );
  });

  it("ranks against the pool when it is known", () => {
    expect(rankLabel(1, 33)).toBe("#1 of 33 that fit you");
    expect(rankLabel(2, null)).toBe("#2");
    expect(rankLabel(5, 3)).toBe("#5");
  });

  it("browse label: total, starred when provisional, hidden when nothing is scored", () => {
    expect(browseScoreLabel({ total: 21, missing: [] })).toBe("SCORE 21");
    expect(browseScoreLabel({ total: 19, missing: ["R"] })).toBe("SCORE 19*");
    expect(browseScoreLabel({ total: 15, missing: ["S", "C", "O", "R", "E"] })).toBeNull();
    expect(browseScoreLabel(undefined)).toBeNull();
  });
});
