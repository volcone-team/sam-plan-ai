import { describe, it, expect } from "vitest";
import {
  dashboardStatus,
  statusDisplay,
  pacePosition,
  paceLabel,
  roi,
  formatRoi,
  percentOfBaseline,
  progressPercent,
  daysUntil,
  countdownLabel,
  runDayLabel,
  elapsedFraction,
  scenarioLanding,
  scenarioLandingLabel,
  byLaunchDate,
} from "./initiative-dashboard";

/**
 * The rule these protect: Net and ROI must NEVER appear on a Draft or Scheduled
 * card. Showing "Net $0" on work that has not started reads as a loss, which is
 * precisely the confusion the redesign set out to remove.
 */
describe("dashboardStatus", () => {
  it("treats planned with no event date as draft", () => {
    expect(dashboardStatus({ status: "planned", eventDate: null })).toBe("draft");
  });

  it("treats planned WITH an event date as scheduled", () => {
    expect(dashboardStatus({ status: "planned", eventDate: "2026-03-15" })).toBe("scheduled");
  });

  it("treats a missing event date field as draft", () => {
    expect(dashboardStatus({ status: "planned" })).toBe("draft");
  });

  it("maps in_progress and launched to live", () => {
    expect(dashboardStatus({ status: "in_progress" })).toBe("live");
    expect(dashboardStatus({ status: "launched" })).toBe("live");
  });

  it("maps completed to complete", () => {
    expect(dashboardStatus({ status: "completed" })).toBe("complete");
  });

  // Terminal, non-active states share the complete layout rather than needing
  // a fifth one.
  it("maps paused and retired to complete", () => {
    expect(dashboardStatus({ status: "paused" })).toBe("complete");
    expect(dashboardStatus({ status: "retired" })).toBe("complete");
  });

  it("falls back to draft for an unknown status with no date", () => {
    expect(dashboardStatus({ status: "something_new" })).toBe("draft");
  });
});

describe("statusDisplay", () => {
  it("hides net and ROI on draft", () => {
    const d = statusDisplay("draft");
    expect(d.showNetAndRoi).toBe(false);
    expect(d.showActuals).toBe(false);
    expect(d.showProjections).toBe(true);
  });

  it("hides net and ROI on scheduled", () => {
    const d = statusDisplay("scheduled");
    expect(d.showNetAndRoi).toBe(false);
    expect(d.showActuals).toBe(false);
  });

  it("shows actuals, net and ROI on live", () => {
    const d = statusDisplay("live");
    expect(d.showActuals).toBe(true);
    expect(d.showNetAndRoi).toBe(true);
    expect(d.showProjections).toBe(false);
  });

  it("shows actuals, net and ROI on complete", () => {
    const d = statusDisplay("complete");
    expect(d.showActuals).toBe(true);
    expect(d.showNetAndRoi).toBe(true);
  });

  it("gives scheduled exact dates but not draft", () => {
    expect(statusDisplay("scheduled").showExactDates).toBe(true);
    expect(statusDisplay("draft").showExactDates).toBe(false);
  });

  it("uses the specified footer action per state", () => {
    expect(statusDisplay("draft").footerLabel).toBe("Schedule this initiative");
    expect(statusDisplay("scheduled").footerLabel).toBe("Open initiative");
    expect(statusDisplay("live").footerLabel).toBe("Log revenue");
    expect(statusDisplay("complete").footerLabel).toBe("Run it again");
  });
});

describe("pacePosition", () => {
  it("is on pace when earnings track elapsed time", () => {
    expect(pacePosition({ earned: 50, projected: 100, elapsedFraction: 0.5 })).toBe("on");
  });

  it("is ahead when well past the elapsed expectation", () => {
    expect(pacePosition({ earned: 80, projected: 100, elapsedFraction: 0.5 })).toBe("ahead");
  });

  it("is behind when short of it", () => {
    expect(pacePosition({ earned: 10, projected: 100, elapsedFraction: 0.5 })).toBe("behind");
  });

  // Measured against elapsed time, not the final target: otherwise everything
  // reads "behind" until the last day.
  it("does not call early progress behind", () => {
    expect(pacePosition({ earned: 10, projected: 100, elapsedFraction: 0.1 })).toBe("on");
  });

  it("tolerates ordinary noise as on pace", () => {
    expect(pacePosition({ earned: 46, projected: 100, elapsedFraction: 0.5 })).toBe("on");
    expect(pacePosition({ earned: 54, projected: 100, elapsedFraction: 0.5 })).toBe("on");
  });

  it("is unknown with no projection", () => {
    expect(pacePosition({ earned: 10, projected: 0, elapsedFraction: 0.5 })).toBe("unknown");
  });

  it("is unknown before the window opens", () => {
    expect(pacePosition({ earned: 0, projected: 100, elapsedFraction: 0 })).toBe("unknown");
  });

  it("has no label when unknown", () => {
    expect(paceLabel("unknown")).toBe("");
  });
});

describe("roi", () => {
  it("computes a multiple", () => {
    expect(roi(1000, 250)).toBe(4);
  });

  // 0x would claim a measured result where none exists.
  it("is null with no spend", () => {
    expect(roi(1000, 0)).toBeNull();
  });

  it("is null for non-finite input", () => {
    expect(roi(NaN, 100)).toBeNull();
  });

  it("renders a dash when null", () => {
    expect(formatRoi(null)).toBe("—");
  });

  it("keeps one decimal below 10x", () => {
    expect(formatRoi(4.25)).toBe("4.3x");
  });

  it("rounds above 10x where precision stops mattering", () => {
    expect(formatRoi(35.4)).toBe("35x");
  });
});

describe("percentOfBaseline", () => {
  it("computes a share of the goal", () => {
    expect(percentOfBaseline(35000, 75000)).toBe(47);
  });

  it("caps at 100", () => {
    expect(percentOfBaseline(200000, 75000)).toBe(100);
  });

  it("is zero with no goal rather than dividing by zero", () => {
    expect(percentOfBaseline(35000, 0)).toBe(0);
  });

  it("never goes negative", () => {
    expect(percentOfBaseline(-5000, 75000)).toBe(0);
  });
});

describe("progressPercent", () => {
  it("computes and caps progress", () => {
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(150, 100)).toBe(100);
  });

  it("is zero with no target", () => {
    expect(progressPercent(50, 0)).toBe(0);
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-03-01T12:00:00Z");

  it("counts forward", () => {
    expect(daysUntil("2026-03-15", now)).toBe(14);
  });

  it("is zero today", () => {
    expect(daysUntil("2026-03-01", now)).toBe(0);
  });

  it("goes negative in the past", () => {
    expect(daysUntil("2026-02-20", now)).toBe(-9);
  });

  it("is null for missing or unparseable input", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("nonsense", now)).toBeNull();
  });
});

describe("countdownLabel", () => {
  const now = new Date("2026-03-01T12:00:00Z");

  it("phrases a multi-day countdown", () => {
    expect(countdownLabel("2026-03-13", now)).toBe("starts in 12 days");
  });

  it("special-cases today and tomorrow", () => {
    expect(countdownLabel("2026-03-01", now)).toBe("starts today");
    expect(countdownLabel("2026-03-02", now)).toBe("starts tomorrow");
  });

  it("says nothing once the date has passed", () => {
    expect(countdownLabel("2026-02-01", now)).toBe("");
  });
});

describe("runDayLabel", () => {
  const now = new Date("2026-03-09T12:00:00Z");

  it("reports the day within the window", () => {
    expect(runDayLabel("2026-03-01", "2026-03-21", now)).toBe("day 9 of 21");
  });

  // A day count on something that has not begun is nonsense.
  it("is null before the window opens", () => {
    expect(runDayLabel("2026-04-01", "2026-04-21", now)).toBeNull();
  });

  it("is null without both endpoints", () => {
    expect(runDayLabel("2026-03-01", null, now)).toBeNull();
  });
});

describe("elapsedFraction", () => {
  it("is half way through a window", () => {
    expect(elapsedFraction("2026-03-01", "2026-03-21", new Date("2026-03-11T12:00:00Z"))).toBeCloseTo(0.5, 1);
  });

  it("is zero before the start", () => {
    expect(elapsedFraction("2026-03-01", "2026-03-21", new Date("2026-02-01T12:00:00Z"))).toBe(0);
  });

  it("caps at one after the end", () => {
    expect(elapsedFraction("2026-03-01", "2026-03-21", new Date("2026-05-01T12:00:00Z"))).toBe(1);
  });
});

describe("scenarioLanding", () => {
  const s = { good: 100, better: 200, best: 300 };

  it("identifies each band", () => {
    expect(scenarioLanding(50, s)).toBe("below good");
    expect(scenarioLanding(150, s)).toBe("good");
    expect(scenarioLanding(250, s)).toBe("better");
    expect(scenarioLanding(300, s)).toBe("best");
    expect(scenarioLanding(400, s)).toBe("above best");
  });

  it("is unknown with no scenarios set", () => {
    expect(scenarioLanding(100, { good: 0, better: 0, best: 0 })).toBe("unknown");
  });

  it("has no label when unknown", () => {
    expect(scenarioLandingLabel("unknown")).toBe("");
  });

  it("phrases the bands for display", () => {
    expect(scenarioLandingLabel("better")).toMatch(/better case/i);
    expect(scenarioLandingLabel("above best")).toMatch(/beat/i);
  });
});

describe("byLaunchDate", () => {
  it("sorts ascending by date", () => {
    const rows = [
      { name: "b", activationDate: "2026-06-01" },
      { name: "a", activationDate: "2026-01-01" },
    ];
    expect([...rows].sort(byLaunchDate).map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("prefers the event date when present", () => {
    const rows = [
      { name: "b", activationDate: "2026-01-01", eventDate: "2026-12-01" },
      { name: "a", activationDate: "2026-02-01", eventDate: "2026-03-01" },
    ];
    expect([...rows].sort(byLaunchDate).map((r) => r.name)).toEqual(["a", "b"]);
  });

  // Undated rows must sink, not sort as 1970 and lead the list.
  it("puts undated initiatives last", () => {
    const rows = [
      { name: "undated", activationDate: null },
      { name: "dated", activationDate: "2026-06-01" },
    ];
    expect([...rows].sort(byLaunchDate).map((r) => r.name)).toEqual(["dated", "undated"]);
  });
});
