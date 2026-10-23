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

describe("parseCreateInitiativeRequest — migration 045 fields", () => {
  const NEW_KEYS = [
    "conversionPath", "audienceSource", "format", "categoryId", "revenueCloseDate",
    "activationDatePrecision", "eventDatePrecision", "attrs",
  ];
  const full = {
    ...base,
    conversionPath: "offer", audienceSource: "own", format: "digital", categoryId: "webinars",
    revenueCloseDate: "2026-12-05", activationDatePrecision: "month", eventDatePrecision: "day",
    attrs: { entry_price: 49 },
  };

  it("adds no new keys to an old-form request", () => {
    const r = parseCreateInitiativeRequest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of NEW_KEYS) expect(k in r.value).toBe(false);
    expect(r.value.productId).toBe(PRODUCT);
    expect(r.value.activationDate).toBe("2026-11-01");
  });

  it("carries every new field when valid", () => {
    const r = parseCreateInitiativeRequest(full);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      conversionPath: "offer", audienceSource: "own", format: "digital", categoryId: "webinars",
      revenueCloseDate: "2026-12-05", activationDatePrecision: "month", eventDatePrecision: "day",
      attrs: { entry_price: 49 },
    });
  });

  it("accepts every vocabulary value", () => {
    for (const conversionPath of ["offer", "calls", "leads", "speaker-fee"]) {
      expect(parseCreateInitiativeRequest({ ...base, conversionPath }).ok).toBe(true);
    }
    for (const audienceSource of ["own", "borrowed"]) {
      expect(parseCreateInitiativeRequest({ ...base, audienceSource }).ok).toBe(true);
    }
    for (const format of ["in-person", "digital", "hybrid"]) {
      expect(parseCreateInitiativeRequest({ ...base, format }).ok).toBe(true);
    }
    for (const p of ["day", "month"]) {
      expect(parseCreateInitiativeRequest({ ...base, activationDatePrecision: p, eventDatePrecision: p }).ok).toBe(true);
    }
  });

  it("keeps an explicit null on the nullable fields", () => {
    const r = parseCreateInitiativeRequest({
      ...base, conversionPath: null, audienceSource: null, format: null, categoryId: null, revenueCloseDate: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      conversionPath: null, audienceSource: null, format: null, categoryId: null, revenueCloseDate: null,
    });
  });

  it("rejects bad values with a specific error", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ conversionPath: "sale" }, /conversion path/i],
      [{ audienceSource: "mixed" }, /audience source/i],
      [{ format: "virtual" }, /format/i],
      [{ categoryId: "Webinars" }, /category/i],
      [{ revenueCloseDate: "2026-02-30" }, /close date/i],
      [{ revenueCloseDate: "" }, /close date/i],
      [{ activationDatePrecision: "year" }, /activation date precision/i],
      [{ activationDatePrecision: null }, /activation date precision/i],
      [{ eventDatePrecision: "week" }, /event date precision/i],
    ];
    for (const [patch, msg] of cases) {
      const r = parseCreateInitiativeRequest({ ...base, ...patch });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
  });

  it("rejects attrs that are not a plain object", () => {
    for (const attrs of [[], [1], null, "x", 3, true, new Date()]) {
      const r = parseCreateInitiativeRequest({ ...base, attrs });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/attributes/i);
    }
    expect(parseCreateInitiativeRequest({ ...base, attrs: {} }).ok).toBe(true);
  });

  it("allows a null / absent product and activation date only with a categoryId", () => {
    for (const blank of [null, undefined]) {
      const r = parseCreateInitiativeRequest({ ...base, categoryId: "paid-ads", productId: blank, activationDate: blank });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.productId).toBeNull();
        expect(r.value.activationDate).toBeNull();
      }
      // Without a category — or with a null one — today's rules hold.
      expect(parseCreateInitiativeRequest({ ...base, productId: blank }).ok).toBe(false);
      expect(parseCreateInitiativeRequest({ ...base, activationDate: blank }).ok).toBe(false);
      expect(parseCreateInitiativeRequest({ ...base, categoryId: null, productId: blank }).ok).toBe(false);
      expect(parseCreateInitiativeRequest({ ...base, categoryId: null, activationDate: blank }).ok).toBe(false);
    }
  });

  it("still validates a product or activation date a new-form request does send", () => {
    expect(parseCreateInitiativeRequest({ ...full, productId: "" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...full, productId: "nope" }).ok).toBe(false);
    expect(parseCreateInitiativeRequest({ ...full, activationDate: "2026-13-01" }).ok).toBe(false);
  });
});
