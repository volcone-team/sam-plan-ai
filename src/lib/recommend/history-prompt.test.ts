import { describe, it, expect } from "vitest";
import { historyPromptLines, HISTORY_PROMPT_RULE } from "./history-prompt";

describe("historyPromptLines", () => {
  it("states both free-text answers next to each other", () => {
    expect(
      historyPromptLines(
        {
          what_worked_notes: "Webinars after a podcast appearance.",
          what_failed_notes: "Cold Facebook ads to a webinar; nobody showed up.",
        },
        []
      )
    ).toEqual([
      "What has worked: Webinars after a podcast appearance.",
      "What has not worked: Cold Facebook ads to a webinar; nobody showed up.",
    ]);
  });

  it("omits blank or missing answers", () => {
    expect(historyPromptLines({ what_worked_notes: "  ", what_failed_notes: null }, [])).toEqual(
      []
    );
    expect(historyPromptLines({}, [])).toEqual([]);
  });

  it("still lists legacy failed initiative keys", () => {
    expect(historyPromptLines({ what_failed_notes: "Cold calling" }, ["paid_ads", "cold_dm"]))
      .toEqual([
        "What has not worked: Cold calling",
        "Already tried and failed: paid_ads, cold_dm",
      ]);
  });
});

describe("HISTORY_PROMPT_RULE", () => {
  it("tells the model not to recommend what has not worked", () => {
    expect(HISTORY_PROMPT_RULE).toContain('"What has not worked"');
    expect(HISTORY_PROMPT_RULE).toContain("Do not recommend those plays");
    expect(HISTORY_PROMPT_RULE.startsWith("- ")).toBe(true);
  });
});
