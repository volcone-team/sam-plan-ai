import { describe, it, expect } from "vitest";
import { buildUsageRows, pickCurrentPlanYear } from "./usage-rows";

const starterLimits = [
  { key: "max_users", label: "Team members", value: 1 },
  { key: "max_initiatives", label: "Initiatives", value: 1 },
  { key: "plan_regenerations", label: "Plan regenerations", value: 2 },
  { key: "ai_uses_month", label: "AI uses", value: 2 },
  { key: "max_products", label: "Products", value: 2 },
];

describe("pickCurrentPlanYear", () => {
  it("prefers the plan covering this year, then the next ahead, then the latest", () => {
    expect(pickCurrentPlanYear([2025, 2026, 2027], 2026)).toBe(2026);
    expect(pickCurrentPlanYear([2025, 2027, 2028], 2026)).toBe(2027);
    expect(pickCurrentPlanYear([2023, 2024], 2026)).toBe(2024);
    expect(pickCurrentPlanYear([], 2026)).toBeNull();
  });
});

describe("buildUsageRows", () => {
  it("shows live totals for initiatives, products and team, and counters for monthly keys", () => {
    // Company b20d0efd's shape: 2 initiatives, 3 products, 4 profiles, 2 AI uses.
    const rows = buildUsageRows({
      planLimits: starterLimits,
      periodUsed: new Map([["ai_uses_month", 2], ["max_products", 99]]),
      live: { initiatives: { year: 2026, count: 2 }, products: 3, users: 4 },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(byKey.max_initiatives).toMatchObject({
      label: "Initiatives in your 2026 plan", used: 2, limit: 1, overLimit: true, scope: "plan_year", planYear: 2026,
    });
    // The stale counter value (99) is ignored for a live key.
    expect(byKey.max_products).toMatchObject({ used: 3, limit: 2, overLimit: true, scope: "total" });
    expect(byKey.max_users).toMatchObject({ used: 4, limit: 1, overLimit: true, scope: "total" });
    expect(byKey.ai_uses_month).toMatchObject({ used: 2, limit: 2, overLimit: false, scope: "period" });
    expect(byKey.plan_regenerations).toMatchObject({ used: 0, scope: "period" });
  });

  it("keeps the plain label when there is no plan year yet", () => {
    const [row] = buildUsageRows({
      planLimits: [{ key: "max_initiatives", label: "Initiatives", value: 3 }],
      periodUsed: new Map(),
      live: { initiatives: { year: null, count: 0 }, products: 0, users: 1 },
    });
    expect(row).toMatchObject({ label: "Initiatives", used: 0, overLimit: false });
  });

  it("never marks unlimited or not-included rows as over", () => {
    const rows = buildUsageRows({
      planLimits: [
        { key: "max_products", label: "Products", value: -1 },
        { key: "max_users", label: "Team members", value: 0 },
      ],
      periodUsed: new Map(),
      live: { initiatives: { year: 2026, count: 0 }, products: 40, users: 3 },
    });
    expect(rows.map((r) => r.overLimit)).toEqual([false, false]);
    expect(rows[0].unlimited).toBe(true);
    expect(rows[1].notIncluded).toBe(true);
  });
});
