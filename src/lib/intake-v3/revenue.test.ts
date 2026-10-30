import { describe, it, expect } from "vitest";
import type { InitiativeFunnel } from "../intake-forecast";
import type { RevenueLine } from "./library-config";
import {
  BEST_MULTIPLIER,
  BETTER_MULTIPLIER,
  IMPLICIT_LINE_ID,
  commissionForScenarios,
  goalScenarios,
  isLeadsPath,
  leadsRevenue,
  metricsModeAvailable,
  metricsScenarios,
  resolveRevenueLines,
  rollUpRevenue,
  rollupItemFrom,
  type RevenueAnswers,
} from "./revenue";

/* The panel's expressions, copied verbatim from add-initiative-panel.tsx. */
const panel = (initiativeTarget: string) => ({
  good: initiativeTarget ? parseFloat(initiativeTarget) : 0,
  better: initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.1) : 0,
  best: initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.2) : 0,
});

describe("goal mode", () => {
  it("exports the panel's multipliers", () => {
    expect(BETTER_MULTIPLIER).toBe(1.1);
    expect(BEST_MULTIPLIER).toBe(1.2);
  });

  it("computes good/better/best", () => {
    expect(goalScenarios(100000)).toEqual({
      ok: true,
      scenarios: { good: 100000, better: 110000, best: 120000 },
    });
  });

  it("rounds exactly like the panel at float half-points", () => {
    // 1005 * 1.1 = 1105.5 -> 1106; 1002.5 * 1.2 = 1203 (Math.round rounds half up).
    expect(goalScenarios(1005)).toMatchObject({ scenarios: { better: 1106 } });
    expect(goalScenarios(1002.5)).toMatchObject({ scenarios: { best: 1203 } });
  });

  it("matches the panel for every target 0..20000 and decimal strings", () => {
    const inputs: string[] = [];
    for (let i = 0; i <= 20000; i++) inputs.push(String(i));
    for (let i = 0; i < 2000; i++) inputs.push((i * 7.37).toFixed(2));
    for (const s of inputs) {
      const r = goalScenarios(s);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.scenarios).toEqual(panel(s));
    }
  });

  it("refuses missing and invalid input without throwing", () => {
    expect(goalScenarios(null)).toMatchObject({ ok: false, reason: "missing" });
    expect(goalScenarios("  ")).toMatchObject({ ok: false, reason: "missing" });
    expect(goalScenarios("abc")).toMatchObject({ ok: false, reason: "invalid" });
    expect(goalScenarios(-5)).toMatchObject({ ok: false, reason: "invalid" });
    expect(goalScenarios(0)).toEqual({ ok: true, scenarios: { good: 0, better: 0, best: 0 } });
  });
});

describe("metrics mode", () => {
  const funnel = (audience: number | null, pct: number | null, price = 5000): InitiativeFunnel => ({
    audienceReached: audience,
    stages: [
      { key: "reg", label: "Registered", percent: 12 },
      { key: "show", label: "Showed", percent: 30 },
      { key: "buy", label: "Bought", percent: pct },
    ],
    averagePrice: price,
  });

  it("forecasts each scenario through forecastPerRun", () => {
    const r = metricsScenarios(
      { good: funnel(3000, 4), better: funnel(3000, 5), best: funnel(3000, 6) },
      { isCustom: false }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.good.status === "available" && r.good.revenue).toBeCloseTo(21600);
    expect(r.better.status === "available" && r.better.revenue).toBeCloseTo(27000);
    expect(r.best.status === "available" && r.best.revenue).toBeCloseTo(32400);
  });

  it("marks an incomplete funnel unavailable, not 0", () => {
    const r = metricsScenarios(
      { good: funnel(3000, 4), better: funnel(3000, null), best: funnel(null, 6) },
      { isCustom: false }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.good.status).toBe("available");
    expect(r.better.status).toBe("unavailable");
    expect(r.best.status).toBe("unavailable");
    expect(r.better).not.toHaveProperty("revenue");
  });

  it("is unavailable for custom initiatives", () => {
    expect(metricsModeAvailable({ isCustom: true })).toBe(false);
    expect(metricsModeAvailable({ isCustom: false })).toBe(true);
    const f = funnel(3000, 4);
    expect(metricsScenarios({ good: f, better: f, best: f }, { isCustom: true })).toMatchObject({
      ok: false,
      reason: "custom_initiative",
    });
  });
});

describe("revenue lines", () => {
  const challengeLines: RevenueLine[] = [
    { id: "entry", priceSource: "attrs.entry_price", windowOpens: "registration_opens", windowCloses: "registration_closes" },
    { id: "vip", priceSource: "host_fee", windowOpens: "registration_opens", windowCloses: "event_date" },
    { id: "offer", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes", condition: "path=offer" },
  ];
  const challengeAnswers: RevenueAnswers = {
    attrs: { entry_price: 47 },
    host_fee: 197,
    product: { price: 997 },
    dates: {
      registration_opens: "2027-02-01",
      registration_closes: "2027-03-01",
      event_date: "2027-03-03",
      cart_opens: "2027-03-05",
      cart_closes: "2027-03-10",
    },
    units: { entry: 200, vip: 30, offer: 10 },
  };

  it("resolves a three-line paid challenge", () => {
    const r = resolveRevenueLines(challengeLines, challengeAnswers);
    expect(r.complete).toBe(true);
    expect(r.lines.map((l) => (l.status === "resolved" ? l.target : null))).toEqual([9400, 5910, 9970]);
    expect(r.total).toBe(25280);
    expect(r.scenarios).toEqual({ good: 25280, better: 27808, best: 30336 });
    const offer = r.lines[2];
    expect(offer.condition).toBe("path=offer");
    expect(offer.status === "resolved" && offer.window).toEqual({
      opens: { name: "cart_opens", date: "2027-03-05" },
      closes: { name: "cart_closes", date: "2027-03-10" },
    });
  });

  it("reports unresolvable lines with a reason and keeps them", () => {
    const r = resolveRevenueLines(challengeLines, {
      ...challengeAnswers,
      host_fee: null,
      dates: { ...challengeAnswers.dates, cart_closes: "2027-03-01" },
    });
    expect(r.lines).toHaveLength(3);
    expect(r.lines.map((l) => l.status)).toEqual(["resolved", "unresolved", "unresolved"]);
    expect(r.lines[1]).toMatchObject({ id: "vip", reason: "missing_price" });
    expect(r.lines[2]).toMatchObject({ id: "offer", reason: "window_inverted", condition: "path=offer" });
    expect(r.complete).toBe(false);
    expect(r.unresolvedCount).toBe(2);
    expect(r.total).toBe(9400);
  });

  it("reports missing dates and missing units", () => {
    const r = resolveRevenueLines(challengeLines, {
      ...challengeAnswers,
      dates: { ...challengeAnswers.dates, registration_opens: null },
      units: { offer: undefined },
    });
    expect(r.lines.map((l) => l.status === "unresolved" && l.reason)).toEqual([
      "missing_window_opens",
      "missing_window_opens",
      "missing_units",
    ]);
  });

  it("resolves host_fee", () => {
    const r = resolveRevenueLines(
      [{ id: "fee", priceSource: "host_fee", windowOpens: "contract_terms", windowCloses: "event_date" }],
      { host_fee: 2500, dates: { contract_terms: "2027-01-10", event_date: "2027-04-01" }, units: { fee: 1 } }
    );
    expect(r.total).toBe(2500);
  });

  it("zero lines gives one implicit line over activation -> close", () => {
    const r = resolveRevenueLines([], {
      product: { price: 500 },
      activation_date: "2027-01-01",
      dates: { close_date: "2027-06-30" },
      units: { [IMPLICIT_LINE_ID]: 12 },
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      status: "resolved",
      id: IMPLICIT_LINE_ID,
      implicit: true,
      target: 6000,
      window: {
        opens: { name: "activation_date", date: "2027-01-01" },
        closes: { name: "close_date", date: "2027-06-30" },
      },
    });
    expect(r.scenarios).toEqual({ good: 6000, better: 6600, best: 7200 });

    const missing = resolveRevenueLines([], { product: { price: 500 }, units: { implicit: 1 } });
    expect(missing.lines[0]).toMatchObject({ status: "unresolved", implicit: true, reason: "missing_window_opens" });
    expect(missing.total).toBe(0);
  });
});

describe("leads path", () => {
  it("has no revenue and no target", () => {
    expect(isLeadsPath("leads")).toBe(true);
    expect(isLeadsPath("offer")).toBe(false);
    expect(leadsRevenue()).toEqual({ kind: "leads", revenue: null, target: null });
  });

  it("counts as 0 in the roll-up, not excluded", () => {
    const r = rollUpRevenue({
      items: [
        rollupItemFrom("a", { good: 60000, better: 66000, best: 75000 }),
        rollupItemFrom("b", leadsRevenue()),
      ],
      baselineTarget: 100000,
      stretchTarget: 150000,
    });
    expect(r.itemCount).toBe(2);
    expect(r.leadsCount).toBe(1);
    expect(r.baseline).toMatchObject({ planned: 60000, gap: 40000 });
  });
});

describe("commission", () => {
  it("percent across scenarios", () => {
    const g = goalScenarios(10000);
    if (!g.ok) throw new Error("unreachable");
    const r = commissionForScenarios(g.scenarios, { type: "percent", percent: 20 });
    expect(r).toMatchObject({
      ok: true,
      good: { commission: 2000, sales: null },
      better: { commission: 2200 },
      best: { commission: 2400 },
    });
  });

  it("flat per sale floors to whole sales", () => {
    // 10000 / 997 = 10.03 -> 10; 11000 -> 11.03 -> 11; 12500 -> 12.54 -> 12.
    const r = commissionForScenarios({ good: 10000, better: 11000, best: 12500 }, { type: "flat", perSale: 100 }, 997);
    expect(r).toMatchObject({
      ok: true,
      good: { sales: 10, commission: 1000 },
      better: { sales: 11, commission: 1100 },
      best: { sales: 12, commission: 1200 },
    });
  });

  it("flat recovers exact units despite float error", () => {
    // 0.1 * 3 = 0.30000000000000004 and 0.3 / 0.1 = 2.9999999999999996.
    const r = commissionForScenarios({ good: 0.3, better: 0.3, best: 0.3 }, { type: "flat", perSale: 1 }, 0.1);
    expect(r).toMatchObject({ ok: true, good: { sales: 3 } });
  });

  it("keeps unavailable scenarios unavailable and refuses bad rules", () => {
    const r = commissionForScenarios(
      { good: { status: "available", revenue: 1000 }, better: { status: "unavailable", reason: "x" }, best: null },
      { type: "percent", percent: 10 }
    );
    expect(r).toMatchObject({ ok: true, good: { commission: 100 }, better: { status: "unavailable" }, best: { status: "unavailable" } });
    expect(commissionForScenarios({ good: 1, better: 1, best: 1 }, { type: "percent", percent: 120 })).toMatchObject({ ok: false, reason: "invalid_rule" });
    expect(commissionForScenarios({ good: 1, better: 1, best: 1 }, { type: "flat", perSale: 5 })).toMatchObject({ ok: false, reason: "missing_price" });
  });
});

describe("roll-up", () => {
  it("sums Good vs Baseline and Best vs Stretch with gaps; Better is not rolled up", () => {
    const r = rollUpRevenue({
      items: [
        { id: "a", good: 100000, best: 125000 },
        { id: "b", good: 50000, best: 62500 },
      ],
      baselineTarget: 200000,
      stretchTarget: 180000,
    });
    expect(r.baseline).toEqual({ status: "compared", target: 200000, planned: 150000, gap: 50000, surplus: 0, covered: false });
    expect(r.stretch).toEqual({ status: "compared", target: 180000, planned: 187500, gap: 0, surplus: 7500, covered: true });
    expect(r).not.toHaveProperty("better");
  });

  it("counts unavailable metrics scenarios as 0 and reports missing targets", () => {
    const m = metricsScenarios(
      {
        good: { audienceReached: 1000, stages: [{ key: "b", label: "Bought", percent: 10 }], averagePrice: 100 },
        better: { audienceReached: 1000, stages: [], averagePrice: 100 },
        best: { audienceReached: null, stages: [], averagePrice: 100 },
      },
      { isCustom: false }
    );
    const r = rollUpRevenue({ items: [rollupItemFrom("m", m)], baselineTarget: null, stretchTarget: 0 });
    expect(r.incompleteCount).toBe(1);
    expect(r.baseline).toEqual({ status: "no_target", planned: 10000 });
    expect(r.stretch).toEqual({ status: "no_target", planned: 0 });
  });
});
