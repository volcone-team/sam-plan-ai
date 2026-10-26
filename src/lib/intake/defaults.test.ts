import { describe, expect, it } from "vitest";
import { productScreenDefaults, withProductScreenDefaults } from "./defaults";
import { DEFAULT_PLANNING_PERIOD, PLANNING_PERIODS } from "./schema";
import { validateProducts } from "./validation";

describe("productScreenDefaults", () => {
  it("sets 12 months when no period is saved", () => {
    expect(productScreenDefaults({})).toEqual({ horizon_months: DEFAULT_PLANNING_PERIOD });
    expect(productScreenDefaults({ horizon_months: null })).toEqual({
      horizon_months: DEFAULT_PLANNING_PERIOD,
    });
  });

  it("does not overwrite a saved 6", () => {
    expect(productScreenDefaults({ horizon_months: 6 })).toEqual({});
    expect(withProductScreenDefaults({ horizon_months: 6 }).horizon_months).toBe(6);
  });

  it("never overwrites any offered period, so an effect using it cannot loop", () => {
    for (const months of PLANNING_PERIODS) {
      expect(productScreenDefaults({ horizon_months: months })).toEqual({});
    }
    // Applying the defaults once leaves nothing more to apply.
    const once = withProductScreenDefaults({});
    expect(productScreenDefaults(once)).toEqual({});
  });

  it("replaces a value that is not an offered period", () => {
    expect(productScreenDefaults({ horizon_months: 24 })).toEqual({
      horizon_months: DEFAULT_PLANNING_PERIOD,
    });
  });

  it("leaves plan_start_month alone — its select shows a placeholder", () => {
    expect(withProductScreenDefaults({}).plan_start_month).toBeUndefined();
  });

  it("returns the same object when nothing applies", () => {
    const answers = { horizon_months: 18, other: "x" };
    expect(withProductScreenDefaults(answers)).toBe(answers);
  });

  it("after defaults, the period never blocks validation", () => {
    for (const horizon of [undefined, null, "", 0, 24, "twelve", 3, 6, 12, 18, "6"]) {
      const answers = withProductScreenDefaults({
        horizon_months: horizon,
        plan_start_month: "2099-01-01",
      });
      const res = validateProducts(answers, [{ name: "A", average_price: 1, units_in_period: 1 }]);
      expect(res.errors.horizon_months).toBeUndefined();
    }
  });
});
