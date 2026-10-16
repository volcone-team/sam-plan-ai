import { describe, it, expect } from "vitest";
import { snapshotPlanYear, snapshotPlanTargets } from "./plan-snapshot-year";

const FALLBACK = 2026;

describe("snapshotPlanYear", () => {
  it("trusts the snapshot's own recorded year", () => {
    expect(snapshotPlanYear({ annualPlan: { year: 2027 } }, FALLBACK)).toBe(2027);
  });

  it("accepts a year stored as a string", () => {
    expect(snapshotPlanYear({ annualPlan: { year: "2027" } }, FALLBACK)).toBe(2027);
  });

  /**
   * THE BUG THIS FIXES. Restore used to take the company's most recent
   * annual_plans row, so a 2026 snapshot landed in a 2027 plan and silently
   * moved a year of work.
   */
  it("ignores what the database currently holds and follows the snapshot", () => {
    // Caller passes the present year as the fallback; the snapshot still wins.
    expect(snapshotPlanYear({ annualPlan: { year: 2026 } }, 2027)).toBe(2026);
  });

  describe("without a recorded year", () => {
    it("derives the year from the initiatives' event dates", () => {
      expect(
        snapshotPlanYear(
          {
            initiatives: [
              { event_date: "2027-03-01" },
              { event_date: "2027-06-15" },
              { event_date: "2027-11-20" },
            ],
          },
          FALLBACK
        )
      ).toBe(2027);
    });

    /** An initiative prepared in December and run in January belongs to January. */
    it("prefers event_date over activation_date", () => {
      expect(
        snapshotPlanYear(
          { initiatives: [{ activation_date: "2026-12-10", event_date: "2027-01-15" }] },
          FALLBACK
        )
      ).toBe(2027);
    });

    it("falls back to activation_date when there is no event date", () => {
      expect(
        snapshotPlanYear(
          { initiatives: [{ activation_date: "2027-05-01", event_date: null }] },
          FALLBACK
        )
      ).toBe(2027);
    });

    /**
     * THE MODE, not the first value. A plan can spill into the following year,
     * and one January initiative must not drag the whole restore with it.
     */
    it("takes the most common year, not the first", () => {
      expect(
        snapshotPlanYear(
          {
            initiatives: [
              { event_date: "2028-01-05" },
              { event_date: "2027-04-01" },
              { event_date: "2027-07-01" },
              { event_date: "2027-10-01" },
            ],
          },
          FALLBACK
        )
      ).toBe(2027);
    });

    it("breaks a tie to the earlier year", () => {
      expect(
        snapshotPlanYear(
          { initiatives: [{ event_date: "2028-02-01" }, { event_date: "2027-02-01" }] },
          FALLBACK
        )
      ).toBe(2027);
    });
  });

  describe("falls back when the snapshot says nothing", () => {
    it("uses the fallback for an empty or absent snapshot", () => {
      expect(snapshotPlanYear(null, FALLBACK)).toBe(FALLBACK);
      expect(snapshotPlanYear(undefined, FALLBACK)).toBe(FALLBACK);
      expect(snapshotPlanYear({}, FALLBACK)).toBe(FALLBACK);
      expect(snapshotPlanYear({ annualPlan: null, initiatives: [] }, FALLBACK)).toBe(FALLBACK);
    });

    it("rejects nonsense years rather than filing a plan under them", () => {
      for (const year of [0, 1, 1899, 9999, "not a year", null, undefined, {}, NaN]) {
        expect(
          snapshotPlanYear({ annualPlan: { year } }, FALLBACK),
          String(year)
        ).toBe(FALLBACK);
      }
    });

    it("ignores undated initiatives", () => {
      expect(
        snapshotPlanYear(
          { initiatives: [{ event_date: null, activation_date: null }, {}] },
          FALLBACK
        )
      ).toBe(FALLBACK);
    });
  });
});

describe("snapshotPlanTargets", () => {
  it("carries the recorded targets", () => {
    expect(
      snapshotPlanTargets({
        annualPlan: {
          year: 2027,
          baseline_revenue: 500000,
          stretch_revenue: 750000,
          operating_budget: 50000,
        },
      } as never)
    ).toEqual({
      baseline_revenue: 500000,
      stretch_revenue: 750000,
      operating_budget: 50000,
    });
  });

  it("coerces strings, as Postgres numerics arrive", () => {
    expect(
      snapshotPlanTargets({
        annualPlan: { baseline_revenue: "500000.00", stretch_revenue: "750000.00" },
      } as never)
    ).toMatchObject({ baseline_revenue: 500000, stretch_revenue: 750000 });
  });

  it("zeroes anything missing or nonsensical", () => {
    expect(snapshotPlanTargets(null)).toEqual({
      baseline_revenue: 0,
      stretch_revenue: 0,
      operating_budget: 0,
    });
    expect(
      snapshotPlanTargets({ annualPlan: { baseline_revenue: -100 } } as never)
    ).toMatchObject({ baseline_revenue: 0 });
    expect(
      snapshotPlanTargets({ annualPlan: { baseline_revenue: "abc" } } as never)
    ).toMatchObject({ baseline_revenue: 0 });
  });
});
