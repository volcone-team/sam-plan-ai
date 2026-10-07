import { describe, it, expect } from "vitest";
import {
  screensFor,
  hasInitiativesScreen,
  progressFor,
  nextScreen,
  prevScreen,
  isFinalScreen,
  finalButtonLabel,
  outputVariantFor,
  outputHeadline,
  showsHelperLine,
  resolveResumeScreen,
  type PlanPath,
  type ScreenId,
} from "./flow";

/**
 * The spec's headline branching rule: Path C has 9 screens, Paths A and B have
 * 10, and the progress bar counts only the screens on the user's own path.
 * Getting this wrong shows "Step 6 of 10" on a 9-screen flow, or lets a Path C
 * user reach a screen their path does not contain.
 */

const ALL_PATHS: PlanPath[] = ["know_most", "know_some", "recommend_all"];

describe("screensFor", () => {
  it("gives Paths A and B ten screens", () => {
    expect(screensFor("know_most")).toHaveLength(10);
    expect(screensFor("know_some")).toHaveLength(10);
  });

  it("gives Path C nine screens", () => {
    expect(screensFor("recommend_all")).toHaveLength(9);
  });

  // Omitted, not hidden: there is nothing to navigate into and nothing to
  // subtract from the total.
  it("OMITS the initiatives screen from Path C entirely", () => {
    expect(screensFor("recommend_all")).not.toContain("initiatives");
  });

  it("includes the initiatives screen on Paths A and B", () => {
    expect(screensFor("know_most")).toContain("initiatives");
    expect(screensFor("know_some")).toContain("initiatives");
  });

  it("starts every path at screen 0 and ends at obstacles", () => {
    for (const path of ALL_PATHS) {
      const screens = screensFor(path);
      expect(screens[0]).toBe("start");
      expect(screens[screens.length - 1]).toBe("obstacles");
    }
  });

  // Before screen 0 is answered we do not know the path; showing the longer
  // sequence stops the bar jumping backwards once they choose.
  it("assumes the longer sequence before a path is chosen", () => {
    expect(screensFor(null)).toHaveLength(10);
  });

  it("keeps the shared screens in spec order", () => {
    expect(screensFor("know_some")).toEqual([
      "start", "business", "team", "products", "goal",
      "initiatives", "wins", "customer", "audience", "obstacles",
    ]);
  });
});

describe("hasInitiativesScreen", () => {
  it("is false only for Path C", () => {
    expect(hasInitiativesScreen("know_most")).toBe(true);
    expect(hasInitiativesScreen("know_some")).toBe(true);
    expect(hasInitiativesScreen("recommend_all")).toBe(false);
  });
});

describe("progressFor", () => {
  it("reports step 1 of 10 at the start of Path A", () => {
    expect(progressFor("know_most", "start")).toMatchObject({ step: 1, total: 10 });
  });

  it("reports step 1 of 9 at the start of Path C", () => {
    expect(progressFor("recommend_all", "start")).toMatchObject({ step: 1, total: 9 });
  });

  /**
   * The specific bug this guards: on Path C, `wins` is the 6th screen. Counting
   * against the 10-screen sequence would call it the 7th and show a total of 10.
   */
  it("counts Path C positions against nine, not ten", () => {
    expect(progressFor("recommend_all", "wins")).toMatchObject({ step: 6, total: 9 });
    expect(progressFor("know_some", "wins")).toMatchObject({ step: 7, total: 10 });
  });

  it("reaches 100% on the last screen of every path", () => {
    for (const path of ALL_PATHS) {
      expect(progressFor(path, "obstacles").percent).toBe(100);
    }
  });

  it("never exceeds the total on any screen of any path", () => {
    for (const path of ALL_PATHS) {
      for (const screen of screensFor(path)) {
        const p = progressFor(path, screen);
        expect(p.step).toBeGreaterThan(0);
        expect(p.step).toBeLessThanOrEqual(p.total);
        expect(p.percent).toBeLessThanOrEqual(100);
      }
    }
  });

  // A stale URL should show an empty bar, not break the page.
  it("reports step 0 for a screen not on this path", () => {
    expect(progressFor("recommend_all", "initiatives")).toMatchObject({ step: 0, percent: 0 });
  });
});

describe("nextScreen", () => {
  it("steps through Path A in order", () => {
    expect(nextScreen("know_most", "goal")).toBe("initiatives");
    expect(nextScreen("know_most", "initiatives")).toBe("wins");
  });

  // The jump that defines Path C.
  it("skips from goal straight to wins on Path C", () => {
    expect(nextScreen("recommend_all", "goal")).toBe("wins");
  });

  it("returns null at the end of every path", () => {
    for (const path of ALL_PATHS) {
      expect(nextScreen(path, "obstacles")).toBeNull();
    }
  });

  it("returns null for a screen not on this path", () => {
    expect(nextScreen("recommend_all", "initiatives")).toBeNull();
  });

  it("can traverse every path from start to finish", () => {
    for (const path of ALL_PATHS) {
      let screen: ScreenId | null = "start";
      const visited: ScreenId[] = [];
      while (screen) {
        visited.push(screen);
        screen = nextScreen(path, screen);
      }
      expect(visited).toEqual(screensFor(path));
    }
  });
});

describe("prevScreen", () => {
  it("goes back through Path A in order", () => {
    expect(prevScreen("know_most", "wins")).toBe("initiatives");
  });

  // Back must not land on a screen this path never had.
  it("goes back from wins to goal on Path C, never to initiatives", () => {
    expect(prevScreen("recommend_all", "wins")).toBe("goal");
  });

  it("returns null at the start of every path", () => {
    for (const path of ALL_PATHS) {
      expect(prevScreen(path, "start")).toBeNull();
    }
  });

  it("round-trips with nextScreen across every path", () => {
    for (const path of ALL_PATHS) {
      for (const screen of screensFor(path)) {
        const next = nextScreen(path, screen);
        if (next) expect(prevScreen(path, next)).toBe(screen);
      }
    }
  });
});

describe("isFinalScreen", () => {
  it("is true only on obstacles", () => {
    for (const path of ALL_PATHS) {
      expect(isFinalScreen(path, "obstacles")).toBe(true);
      expect(isFinalScreen(path, "goal")).toBe(false);
    }
  });
});

describe("finalButtonLabel", () => {
  // Product copy from the spec, one per path.
  it("matches the spec label for each path", () => {
    expect(finalButtonLabel("know_most")).toBe("Check my plan");
    expect(finalButtonLabel("know_some")).toBe("Fill in my plan");
    expect(finalButtonLabel("recommend_all")).toBe("Recommend my initiatives");
  });

  it("falls back to Continue before a path is chosen", () => {
    expect(finalButtonLabel(null)).toBe("Continue");
  });
});

describe("outputVariantFor / outputHeadline", () => {
  it("maps each path to its output variant", () => {
    expect(outputVariantFor("know_most")).toBe("check_math");
    expect(outputVariantFor("know_some")).toBe("fill_gaps");
    expect(outputVariantFor("recommend_all")).toBe("full_recommendation");
  });

  it("uses the spec headline for each variant", () => {
    expect(outputHeadline("check_math")).toBe("Here's what your plan adds up to");
    expect(outputHeadline("fill_gaps")).toBe("Your initiatives, plus what we'd add");
    expect(outputHeadline("full_recommendation")).toBe("Here's where we'd start");
  });
});

describe("showsHelperLine", () => {
  // Spec: every screen EXCEPT 0, 5 and 9.
  it("hides the helper on screens 0, 5 and 9", () => {
    expect(showsHelperLine("start")).toBe(false);
    expect(showsHelperLine("initiatives")).toBe(false);
    expect(showsHelperLine("obstacles")).toBe(false);
  });

  it("shows the helper on every other screen", () => {
    for (const screen of ["business", "team", "products", "goal", "wins", "customer", "audience"] as ScreenId[]) {
      expect(showsHelperLine(screen)).toBe(true);
    }
  });
});

describe("resolveResumeScreen", () => {
  it("resumes at a stored screen on this path", () => {
    expect(resolveResumeScreen("know_most", "products")).toBe("products");
  });

  /**
   * The reason resume stores a SLUG and not an index: a user who switches to
   * Path C may have `initiatives` stored, which that path does not contain.
   * Restarting is better than stranding them on an unreachable screen.
   */
  it("falls back to start when the stored screen is not on this path", () => {
    expect(resolveResumeScreen("recommend_all", "initiatives")).toBe("start");
  });

  it("falls back to start for unknown or missing values", () => {
    expect(resolveResumeScreen("know_most", "nonsense")).toBe("start");
    expect(resolveResumeScreen("know_most", null)).toBe("start");
    expect(resolveResumeScreen("know_most", undefined)).toBe("start");
    expect(resolveResumeScreen("know_most", "")).toBe("start");
  });
});
