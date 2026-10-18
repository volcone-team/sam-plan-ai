import { describe, it, expect } from "vitest";
import { parseCreateInitiativeRequest } from "@/lib/initiatives/create-request";

const PLAN = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const base = {
  libraryKey: "webinar", annualPlanId: PLAN, productId: PRODUCT, name: " Live Webinar ",
  kind: "one-time", activationDate: "2026-11-01", eventDate: "2026-11-20",
  plannedBudget: 500, trafficInput: "250", revenueScenarios: { good: 1000, better: 1100, best: 1250 },
};

describe("parseCreateInitiativeRequest", () => {
  it("accepts a library pick and normalises it", () => {
    const r = parseCreateInitiativeRequest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ libraryKey: "webinar", name: "Live Webinar", trafficInput: 250, eventDate: "2026-11-20" });
  });

  it("treats a null / empty key as the custom option", () => {
    for (const libraryKey of [null, undefined, ""]) {
      const r = parseCreateInitiativeRequest({ ...base, libraryKey });
      expect(r.ok && r.value.libraryKey).toBeNull();
    }
  });

  it("rejects what the insert would fail on, before touching the database", () => {
    expect(parseCreateInitiativeRequest({ ...base, productId: "" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, annualPlanId: "nope" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, name: "  " }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, kind: "weekly" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, activationDate: "2026-02-30" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, libraryKey: 42 }).ok).toBe(false);
    expect(parseCreateInitiativeRequest(null).ok).toBe(false);
  });

  it("carries a metric selection by shape only, and rejects a malformed one", () => {
    const r = parseCreateInitiativeRequest({ ...base, metricSelection: { groupLabels: ["VIRTUAL", "VIRTUAL"], excludedOptional: [] } });
    expect(r.ok && r.value.metricSelection).toEqual({ groupLabels: ["VIRTUAL"], excludedOptional: [] });
    const none = parseCreateInitiativeRequest(base);
    expect(none.ok && none.value.metricSelection).toBeUndefined();
    expect(parseCreateInitiativeRequest({ ...base, metricSelection: "all" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, metricSelection: { groupLabels: [1] } }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...base, metricSelection: { excludedOptional: "x" } }).ok).toBe(false);
  });

  it("floors junk and negative amounts at zero", () => {
    const r = parseCreateInitiativeRequest({ ...base, plannedBudget: -5, revenueScenarios: { good: "abc" } });
    expect(r.ok && r.value.plannedBudget).toBe(0);
    expect(r.ok && r.value.revenueScenarios).toEqual({ good: 0, better: 0, best: 0 });
  });
});
