import { describe, it, expect } from "vitest";
import {
  renderAccountSnapshot,
  hasUsableAccountData,
  type AccountSnapshot,
} from "./chat-account-context";

/**
 * The rendered snapshot is what the model actually reads about a customer's
 * business, so these assert two things: real figures reach the prompt, and
 * ABSENT data is never presented as if it existed. A model told results exist
 * when they do not will confidently discuss performance the user never entered.
 */

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    companyName: "Starch Industries",
    currency: "USD",
    planningYear: 2026,
    priorYearRevenue: 4500000,
    baselineRevenue: 6060000,
    stretchRevenue: 7880000,
    operatingBudget: 240000,
    products: [],
    initiatives: [],
    results: [],
    totals: { actualRevenue: 0, actualSpend: 0, resultWeeks: 0 },
    intake: null,
    ...overrides,
  };
}

describe("renderAccountSnapshot", () => {
  it("includes the business name and planning year", () => {
    const out = renderAccountSnapshot(snapshot());
    expect(out).toContain("Starch Industries");
    expect(out).toContain("2026");
  });

  it("states revenue targets in full, comma-separated figures", () => {
    const out = renderAccountSnapshot(snapshot());
    expect(out).toContain("$6,060,000");
    expect(out).toContain("$7,880,000");
    // Abbreviated figures would lose precision the model may reason with.
    expect(out).not.toMatch(/6\.06M/);
  });

  it("lists products with price and type", () => {
    const out = renderAccountSnapshot(
      snapshot({
        products: [
          { name: "Coaching Program", price: 5000, revenueType: "recurring", tier: "high" },
        ],
      })
    );
    expect(out).toContain("Coaching Program");
    expect(out).toContain("$5,000");
    expect(out).toContain("recurring");
  });

  it("lists initiatives with status and projected revenue", () => {
    const out = renderAccountSnapshot(
      snapshot({
        initiatives: [
          {
            name: "Spring Webinar", status: "planned", kind: "one-time",
            activationDate: "2026-03-01", eventDate: "2026-03-15",
            revenueBetter: 120000, plannedBudget: 8000, actualSpend: 0,
          },
        ],
      })
    );
    expect(out).toContain("Spring Webinar");
    expect(out).toContain("planned");
    expect(out).toContain("$120,000");
    expect(out).toContain("2026-03-15");
  });

  // The important negative case.
  it("says plainly when no results have been logged", () => {
    const out = renderAccountSnapshot(snapshot());
    expect(out).toMatch(/Recorded results: none yet/i);
  });

  it("summarises recorded results when they exist", () => {
    const out = renderAccountSnapshot(
      snapshot({
        results: [{ weekStart: "2026-09-28", revenue: 42000, spend: 5000 }],
        totals: { actualRevenue: 42000, actualSpend: 5000, resultWeeks: 1 },
      })
    );
    expect(out).toContain("$42,000");
    expect(out).toContain("$5,000");
    expect(out).not.toMatch(/none yet/i);
  });

  it("omits sections with no data rather than writing 'none'", () => {
    const out = renderAccountSnapshot(snapshot());
    expect(out).not.toContain("Products:");
    expect(out).not.toContain("Initiatives in their plan");
  });

  it("includes intake answers the model can reason about", () => {
    const out = renderAccountSnapshot(
      snapshot({
        intake: {
          revenueGoal: 6000000, timeframeMonths: 12,
          idealCustomer: "Service businesses doing $1M-$5M",
          whatWorked: ["Webinars", "Referrals"],
          whatFailed: "Cold outreach never converted",
          monthlyMarketingBudget: 20000, teamSize: 4,
        },
      })
    );
    expect(out).toContain("Service businesses");
    expect(out).toContain("Webinars, Referrals");
    expect(out).toContain("Cold outreach");
    expect(out).toContain("$20,000");
  });

  it("omits a zero prior year rather than reporting $0 revenue", () => {
    const out = renderAccountSnapshot(snapshot({ priorYearRevenue: 0 }));
    expect(out).not.toMatch(/Prior year revenue/);
  });

  it("handles a completely empty account without emitting NaN", () => {
    const out = renderAccountSnapshot(
      snapshot({
        companyName: null, priorYearRevenue: 0, baselineRevenue: 0,
        stretchRevenue: 0, operatingBudget: 0,
      })
    );
    expect(out).not.toMatch(/NaN|undefined/);
    expect(out).toContain("(unnamed)");
  });
});

describe("hasUsableAccountData", () => {
  it("is false with no snapshot", () => {
    expect(hasUsableAccountData(null)).toBe(false);
  });

  // A company row alone (created at signup) is not grounds to claim knowledge
  // of someone's business.
  it("is false for a brand-new empty account", () => {
    expect(
      hasUsableAccountData(
        snapshot({ priorYearRevenue: 0, baselineRevenue: 0, stretchRevenue: 0 })
      )
    ).toBe(false);
  });

  it("is true once targets are set", () => {
    expect(hasUsableAccountData(snapshot())).toBe(true);
  });

  it("is true once products exist", () => {
    expect(
      hasUsableAccountData(
        snapshot({
          baselineRevenue: 0, stretchRevenue: 0,
          products: [{ name: "X", price: 100, revenueType: "one-time", tier: "low" }],
        })
      )
    ).toBe(true);
  });

  it("is true once the questionnaire is answered", () => {
    expect(
      hasUsableAccountData(
        snapshot({
          baselineRevenue: 0, stretchRevenue: 0,
          intake: {
            revenueGoal: 500000, timeframeMonths: 12, idealCustomer: "",
            whatWorked: [], whatFailed: "", monthlyMarketingBudget: 0, teamSize: 1,
          },
        })
      )
    ).toBe(true);
  });
});
