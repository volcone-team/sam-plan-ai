import { describe, expect, it } from "vitest";
import { defaultDashboardYear } from "./default-year";

describe("defaultDashboardYear", () => {
  const goals = (baselineRevenue: number, stretchRevenue: number) => ({ baselineRevenue, stretchRevenue });

  it("opens on next year when this year has no goals and next year does", () => {
    expect(defaultDashboardYear(2026, goals(0, 0), goals(150000, 195000))).toBe(2027);
  });

  it("treats a missing current-year plan as no goals", () => {
    expect(defaultDashboardYear(2026, null, goals(150000, 0))).toBe(2027);
  });

  it("counts a stretch goal on its own as a goal for next year", () => {
    expect(defaultDashboardYear(2026, undefined, goals(0, 50000))).toBe(2027);
  });

  it("stays on this year when it has either goal", () => {
    expect(defaultDashboardYear(2026, goals(100000, 0), goals(150000, 195000))).toBe(2026);
    expect(defaultDashboardYear(2026, goals(0, 100000), goals(150000, 195000))).toBe(2026);
  });

  it("stays on this year when next year has no goals either", () => {
    expect(defaultDashboardYear(2026, goals(0, 0), goals(0, 0))).toBe(2026);
    expect(defaultDashboardYear(2026, null, null)).toBe(2026);
  });
});
