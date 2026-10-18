import { describe, it, expect } from "vitest";
import {
  parseMetricsCell,
  readStoredMetrics,
  toStoredMetrics,
  METRICS_PARSER_VERSION,
  type ParsedMetrics,
} from "@/lib/metrics/parse-metrics";
import {
  METRICS,
  METRICS_BY_KEY,
  SYNONYM_INDEX,
  evaluateFormula,
  formulaInputs,
  resolveMetric,
} from "@/lib/metrics/dictionary";
import { WORKBOOK_METRIC_LINES, WORKBOOK_STRUCTURE_LINES } from "@/lib/metrics/workbook-tokens.fixture";

const keys = (p: ParsedMetrics, group = 0) => p.groups[group]?.metrics.map((m) => m.key) ?? [];
const entered = (p: ParsedMetrics, group = 0) =>
  p.groups[group]?.metrics.filter((m) => m.source === "entered").map((m) => m.key) ?? [];
const derived = (p: ParsedMetrics, group = 0) =>
  p.groups[group]?.metrics.filter((m) => m.source === "derived").map((m) => m.key) ?? [];

/**
 * Accepted unrecognised tokens from the real workbook. Empty on purpose: every
 * line resolves. Anything added here must be justified in review.
 */
const ACCEPTED_UNRECOGNISED: readonly string[] = [];

describe("dictionary", () => {
  it("has unique keys, valid formulas and a sensible size", () => {
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
    expect(METRICS.length).toBeGreaterThanOrEqual(40);
    expect(METRICS.length).toBeLessThanOrEqual(80);
    for (const m of METRICS) {
      expect(m.key, m.key).toMatch(/^[a-z][a-z0-9_]*$/);
      if (m.formula) {
        expect(m.source, m.key).toBe("derived");
        for (const input of formulaInputs(m.formula)) {
          const def = METRICS_BY_KEY.get(input);
          // Inputs must exist, be numeric and be entered (no chains).
          expect(def, `${m.key} reads ${input}`).toBeDefined();
          expect(def!.kind).not.toBe("tag");
          expect(def!.formula, `${m.key} reads derived ${input}`).toBeUndefined();
        }
      } else {
        expect(m.source, m.key).toBe("entered");
      }
      if (m.kind === "tag") expect(m.formula).toBeUndefined();
    }
  });

  it("indexes every synonym to exactly one key (built without throwing)", () => {
    expect(SYNONYM_INDEX.size).toBeGreaterThan(METRICS.length);
  });

  it("keeps a rate apart from its count", () => {
    expect(resolveMetric("Conversion")).toBe("conversion_rate");
    expect(resolveMetric("Conversions")).toBe("conversions");
    expect(resolveMetric("List Growth")).toBe("list_growth");
    expect(resolveMetric("List Growth %")).toBe("list_growth_rate");
  });

  it("evaluates formulas honestly", () => {
    const f = (k: string) => METRICS_BY_KEY.get(k)!.formula!;
    expect(evaluateFormula(f("show_up_rate"), { attendees: 30, registrations: 100 })).toBe(30);
    expect(evaluateFormula(f("roi"), { revenue: 300, cost: 100 })).toBe(200);
    expect(evaluateFormula(f("profit"), { revenue: 300, cost: 100 })).toBe(200);
    expect(evaluateFormula(f("show_up_rate"), { attendees: 30, registrations: 0 })).toBeNull();
    expect(evaluateFormula(f("show_up_rate"), { attendees: 30 })).toBeNull();
  });
});

describe("parseMetricsCell — the real workbook's tokens", () => {
  it("recognises every distinct line", () => {
    const unrecognised = WORKBOOK_METRIC_LINES.flatMap((line) => parseMetricsCell(line).unrecognised);
    expect(unrecognised.filter((u) => !ACCEPTED_UNRECOGNISED.includes(u))).toEqual([]);
  });

  it("turns every non-structure line into a metric or a tag", () => {
    for (const line of WORKBOOK_METRIC_LINES) {
      if (WORKBOOK_STRUCTURE_LINES.includes(line)) continue;
      const p = parseMetricsCell(line);
      expect(p.groups.flatMap((g) => g.metrics).length + p.tags.length, line).toBeGreaterThan(0);
    }
  });
});

describe("parseMetricsCell — rules", () => {
  it("collapses synonyms and dedupes in order", () => {
    const p = parseMetricsCell("- Opt-Ins\n-Optins\nOpt-ins\n- Leads/Opt-ins\n- Views/Visits\n- Visits/Views\n- Attendance\n- Attended");
    expect(entered(p)).toEqual(["optins", "visits", "attendees"]);
  });

  it("fixes the workbook's typos", () => {
    expect(keys(parseMetricsCell("- VIP Ticker Sales\n- Ad spends"))).toEqual(["vip_buyers", "ad_spend"]);
  });

  it("groups under VIRTUAL / IN-PERSON headers", () => {
    const p = parseMetricsCell("VIRTUAL\n- Attendance\n- GA sales\nIN-PERSON\n- Attendance\n- VIP sales");
    expect(p.groups.map((g) => g.label)).toEqual(["VIRTUAL", "IN-PERSON"]);
    expect(entered(p, 0)).toEqual(["attendees", "ga_ticket_sales"]);
    expect(entered(p, 1)).toEqual(["attendees", "vip_buyers"]);
  });

  it("puts lines before a header in a null-label group", () => {
    const p = parseMetricsCell("- Reach\nVIRTUAL\n- Attendees");
    expect(p.groups.map((g) => g.label)).toEqual([null, "VIRTUAL"]);
  });

  it("treats a line ending in ':' as a note, not a group", () => {
    const p = parseMetricsCell("Dependent on channel:\n- Opens\n- Clicks");
    expect(p.notes).toEqual(["Dependent on channel"]);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].label).toBeNull();
    expect(keys(p)).toEqual(["opens", "clicks"]);
  });

  it("marks (if applicable) optional", () => {
    const p = parseMetricsCell("- Calls booked (if applicable)\n- Opens");
    expect(p.groups[0].metrics.map((m) => [m.key, m.optional])).toEqual([["calls_booked", true], ["opens", false]]);
  });

  it("a duplicate stays required if any mention was required", () => {
    const p = parseMetricsCell("- Core offer buyers (if applicable)\n- Buyers");
    expect(p.groups[0].metrics).toEqual([
      { key: "core_offer_buyers", label: "Core offer buyers", optional: false, source: "entered" },
    ]);
  });

  it("splits combined phrases only when every part resolves", () => {
    expect(keys(parseMetricsCell("- Registrations and ticket sales"))).toEqual(["registrations", "ga_ticket_sales"]);
    expect(keys(parseMetricsCell("- GA Registrations or GA ticket sales"))).toEqual(["registrations", "ga_ticket_sales"]);
    expect(keys(parseMetricsCell("- Optins or Core Offer Buyers"))).toEqual(["optins", "core_offer_buyers"]);
    const half = parseMetricsCell("- Registrations and moonbeams");
    expect(half.groups).toEqual([]);
    expect(half.unrecognised).toEqual(["Registrations and moonbeams"]);
  });

  it("prefers the whole phrase over a split", () => {
    expect(keys(parseMetricsCell("- Appointments Made/Calls Booked"))).toEqual(["calls_booked"]);
    expect(keys(parseMetricsCell("Opens/Views"))).toEqual(["opens"]);
  });

  it("appends derived rates after entered metrics when inputs are present", () => {
    const p = parseMetricsCell("- Show rate\n- Registrations\n- Attendees\n- Core Offer Buyers");
    expect(entered(p)).toEqual(["registrations", "attendees", "core_offer_buyers"]);
    expect(derived(p)).toEqual(["show_up_rate", "conversion_rate"]);
  });

  it("keeps a rate entered when its inputs are missing", () => {
    const p = parseMetricsCell("- Registration rate\n- Show-up\n- Conversion");
    expect(entered(p)).toEqual(["registration_rate", "show_up_rate", "conversion_rate"]);
    expect(derived(p)).toEqual([]);
  });

  it("derives money metrics and ROI", () => {
    const p = parseMetricsCell("- Spend\n- Total Revenue\n- Ad Spend\n- Ad Clicks");
    expect(entered(p)).toEqual(["cost", "revenue", "ad_spend", "ad_clicks"]);
    expect(derived(p)).toEqual(["cost_per_click", "profit", "roi"]);
  });

  it("derives per group", () => {
    const p = parseMetricsCell("VIRTUAL\n- Attendance\n- Core offer sales\nIN-PERSON\n- Attendance");
    expect(derived(p, 0)).toEqual(["conversion_rate"]);
    expect(derived(p, 1)).toEqual([]);
  });

  it("a derived metric is optional when an input is", () => {
    const p = parseMetricsCell("- Registrations\n- Attendees (if applicable)");
    expect(p.groups[0].metrics.find((m) => m.key === "show_up_rate")?.optional).toBe(true);
  });

  it("reports tags separately and never as metrics", () => {
    const p = parseMetricsCell("- Buyers\n- Product Category\n- Product type\n- Buyer Plan\n- Product Category");
    expect(p.tags).toEqual(["product_category", "product_type", "buyer_plan"]);
    expect(keys(p)).toEqual(["core_offer_buyers"]);
  });

  it("handles empty, blank and null input", () => {
    const empty = { groups: [], tags: [], unrecognised: [], notes: [] };
    expect(parseMetricsCell(null)).toEqual(empty);
    expect(parseMetricsCell(undefined)).toEqual(empty);
    expect(parseMetricsCell("")).toEqual(empty);
    expect(parseMetricsCell(" \n -  \n")).toEqual(empty);
  });

  it("never throws on odd input", () => {
    for (const odd of ["((((", "-", "::::", "ALLCAPS\nALLCAPS", "\r\n\r", "x".repeat(5000), "/ / /", " and or "]) {
      expect(() => parseMetricsCell(odd)).not.toThrow();
    }
    expect(() => parseMetricsCell(42 as unknown as string)).not.toThrow();
  });

  it("is stable: same input, same output", () => {
    const cell = WORKBOOK_METRIC_LINES.join("\n");
    expect(JSON.stringify(parseMetricsCell(cell))).toBe(JSON.stringify(parseMetricsCell(cell)));
  });
});

describe("stored shape", () => {
  it("round-trips through toStoredMetrics / readStoredMetrics", () => {
    const stored = toStoredMetrics(parseMetricsCell("VIRTUAL\n- Registrations\n- Attendees\n- Product type"));
    expect(stored.version).toBe(METRICS_PARSER_VERSION);
    expect(readStoredMetrics(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("reads the column default and malformed values as null", () => {
    expect(readStoredMetrics([])).toBeNull();
    expect(readStoredMetrics([{ name: "a" }])).toBeNull();
    expect(readStoredMetrics(null)).toBeNull();
    expect(readStoredMetrics("x")).toBeNull();
    expect(readStoredMetrics({ version: 1 })).toBeNull();
  });

  it("drops malformed entries inside an otherwise valid value", () => {
    const r = readStoredMetrics({
      version: 1, tags: ["a", 3], unrecognised: "nope",
      groups: [{ label: 5, metrics: [{ key: "opens" }, { label: "no key" }, null] }, "junk"],
    });
    expect(r).toEqual({
      version: 1, tags: ["a"], unrecognised: [], notes: [],
      groups: [{ label: null, metrics: [{ key: "opens", label: "Opens", optional: false, source: "entered" }] }],
    });
  });
});
