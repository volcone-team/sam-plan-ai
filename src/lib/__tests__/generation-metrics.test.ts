import { describe, it, expect } from "vitest";
import {
  computeAiMetrics,
  type GenerationEventRow,
} from "@/lib/generation-metrics";

const NOW = new Date("2024-06-30T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Build a row `daysAgo` before NOW. */
function row(
  daysAgo: number,
  overrides: Partial<GenerationEventRow> = {}
): GenerationEventRow {
  return {
    event_type: "plan_generation",
    status: "success",
    duration_ms: 4000,
    created_at: new Date(NOW.getTime() - daysAgo * MS_PER_DAY).toISOString(),
    ...overrides,
  };
}

describe("computeAiMetrics", () => {
  it("returns zeros and nulls for empty input rather than misleading numbers", () => {
    expect(computeAiMetrics([], NOW)).toEqual({
      totalGenerations: 0,
      generationsPerDay: 0,
      successRatePct: null,
      avgDurationMs: null,
    });
  });

  it("reports 100% success and the mean duration when every row succeeded", () => {
    const rows = [
      row(1, { duration_ms: 3000 }),
      row(2, { duration_ms: 5000 }),
      row(3, { duration_ms: 4000 }),
    ];

    const m = computeAiMetrics(rows, NOW);

    expect(m.totalGenerations).toBe(3);
    expect(m.successRatePct).toBe(100);
    expect(m.avgDurationMs).toBe(4000);
    // 3 rows / 30 days = 0.1
    expect(m.generationsPerDay).toBe(0.1);
  });

  it("computes success rate across mixed success and failed rows", () => {
    const rows = [
      row(1),
      row(2),
      row(3),
      row(4, { status: "failed", duration_ms: null }),
    ];

    const m = computeAiMetrics(rows, NOW);

    expect(m.totalGenerations).toBe(4);
    expect(m.successRatePct).toBe(75);
  });

  it("excludes failed rows from the duration average", () => {
    const rows = [
      row(1, { duration_ms: 2000 }),
      // A failure that took 60s must not drag the success-time average.
      row(2, { status: "failed", duration_ms: 60000 }),
    ];

    expect(computeAiMetrics(rows, NOW).avgDurationMs).toBe(2000);
  });

  it("excludes rows outside the trailing window from the rate and success rate", () => {
    const rows = [
      row(1),
      row(45, { status: "failed" }), // older than the window
      row(200), // much older
    ];

    const m = computeAiMetrics(rows, NOW);

    // Total counts every row ever.
    expect(m.totalGenerations).toBe(3);
    // Only the 1-day-old row is in the window.
    expect(m.generationsPerDay).toBe(0);
    expect(m.successRatePct).toBe(100);
  });

  it("returns null success rate when nothing falls inside the window", () => {
    const m = computeAiMetrics([row(60), row(90)], NOW);

    expect(m.totalGenerations).toBe(2);
    expect(m.generationsPerDay).toBe(0);
    expect(m.successRatePct).toBeNull();
  });

  it("treats the 30-day boundary as inside the window and 31 days as outside", () => {
    const onBoundary = computeAiMetrics([row(30)], NOW);
    expect(onBoundary.successRatePct).toBe(100);

    const justOutside = computeAiMetrics([row(30.0001)], NOW);
    expect(justOutside.successRatePct).toBeNull();
  });

  it("counts rows with a null duration in totals but not in the average", () => {
    const rows = [
      row(1, { duration_ms: null }),
      row(2, { duration_ms: 6000 }),
      row(3, { duration_ms: null }),
    ];

    const m = computeAiMetrics(rows, NOW);

    expect(m.totalGenerations).toBe(3);
    expect(m.successRatePct).toBe(100);
    // Only the single measured row contributes.
    expect(m.avgDurationMs).toBe(6000);
  });

  it("returns a null average when no successful row recorded a duration", () => {
    const rows = [row(1, { duration_ms: null }), row(2, { duration_ms: null })];
    expect(computeAiMetrics(rows, NOW).avgDurationMs).toBeNull();
  });

  it("scales generationsPerDay to a custom window", () => {
    const rows = [row(1), row(2), row(3), row(4), row(5)];
    // 5 rows over a 10-day window = 0.5/day
    expect(computeAiMetrics(rows, NOW, 10).generationsPerDay).toBe(0.5);
  });
});
