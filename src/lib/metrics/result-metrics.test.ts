import { describe, it, expect } from "vitest";
import { parseMetricsCell } from "@/lib/metrics/parse-metrics";
import { buildMetricSet, metricFieldId, type InitiativeMetricSet } from "@/lib/metrics/metric-set";
import {
  draftFromMetrics,
  formatMetricValue,
  mergeMetricEdit,
  metricAggregate,
  metricFieldsFor,
  metricGroupsOf,
  normaliseMetricInput,
  otherMetricEntries,
  parseMetricDraft,
  summariseMetrics,
  type ResultMetricsRow,
} from "@/lib/metrics/result-metrics";

const WEBINAR = buildMetricSet(
  "webinar",
  parseMetricsCell(["- Registrations", "- Attendees", "- Revenue", "- Cost (if applicable)", "- Followers"].join("\n"))
)!;
const HYBRID = buildMetricSet(
  "event",
  parseMetricsCell(["VIRTUAL", "- Registrations", "- Attendees", "IN-PERSON", "- Registrations", "- Attendees"].join("\n"))
)!;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RUNS = 200;
const week = (i: number) => new Date(Date.UTC(2026, 0, 5 + 7 * i));

describe("metricFieldsFor", () => {
  it("legacy without a set: the keys, unchanged", () => {
    expect(metricFieldsFor({ metricSet: null }, ["registrants", "show_rate"])).toEqual({
      mode: "legacy", keys: ["registrants", "show_rate"],
    });
    expect(metricFieldsFor(undefined, [])).toEqual({ mode: "legacy", keys: [] });
  });

  it("set: entered fields with units and optional flags, derived with formula text", () => {
    const f = metricFieldsFor({ metricSet: WEBINAR }, ["ignored"]);
    expect(f.mode).toBe("set");
    if (f.mode !== "set") return;
    const [g] = f.groups;
    expect(g.fields.map((x) => x.id)).toEqual(["registrations", "attendees", "revenue", "cost", "followers"]);
    expect(g.fields.find((x) => x.id === "cost")).toMatchObject({ kind: "money", unit: "$", optional: true });
    expect(g.derived.find((d) => d.id === "show_up_rate")?.formulaText).toBe("Attendees ÷ Registrations");
    expect(g.derived.find((d) => d.id === "roi")?.formulaText).toBe("(Revenue − Cost) ÷ Cost");
  });

  it("multi-group ids are prefixed", () => {
    expect(metricGroupsOf(HYBRID).map((g) => g.fields.map((x) => x.id))).toEqual([
      ["virtual.registrations", "virtual.attendees"],
      ["in_person.registrations", "in_person.attendees"],
    ]);
  });
});

describe("normaliseMetricInput", () => {
  it("blank is omitted, not 0", () => {
    for (const k of ["count", "money", "rate", "score"] as const) {
      expect(normaliseMetricInput(k, "")).toEqual({ ok: true, value: null });
      expect(normaliseMetricInput(k, "   ")).toEqual({ ok: true, value: null });
      expect(normaliseMetricInput(k, undefined)).toEqual({ ok: true, value: null });
      expect(normaliseMetricInput(k, "0")).toEqual({ ok: true, value: 0 });
    }
  });

  it("per kind", () => {
    expect(normaliseMetricInput("count", "1,200")).toEqual({ ok: true, value: 1200 });
    expect(normaliseMetricInput("count", "2.5").ok).toBe(false);
    expect(normaliseMetricInput("count", "-1").ok).toBe(false);
    expect(normaliseMetricInput("money", "$12.345")).toEqual({ ok: true, value: 12.35 });
    expect(normaliseMetricInput("money", "0.")).toEqual({ ok: true, value: 0 });
    expect(normaliseMetricInput("money", "-3").ok).toBe(false);
    expect(normaliseMetricInput("rate", "12.5%")).toEqual({ ok: true, value: 12.5 });
    expect(normaliseMetricInput("rate", "100.1").ok).toBe(false);
    expect(normaliseMetricInput("score", "-40")).toEqual({ ok: true, value: -40 });
    expect(normaliseMetricInput("tag", "x").ok).toBe(false);
    expect(normaliseMetricInput("count", "abc").ok).toBe(false);
    expect(normaliseMetricInput("money", "1e3").ok).toBe(false);
  });

  it("seeded: valid inputs round-trip within the kind's range", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const c = Math.floor(r() * 100000);
      expect(normaliseMetricInput("count", c.toLocaleString("en-US"))).toEqual({ ok: true, value: c });
      const m = Math.round(r() * 1e6) / 100;
      expect(normaliseMetricInput("money", String(m))).toEqual({ ok: true, value: m });
      const p = Math.round(r() * 1000) / 10;
      expect(normaliseMetricInput("rate", String(p))).toEqual({ ok: true, value: p });
      const out = 100.1 + Math.round(r() * 1000) / 10;
      expect(normaliseMetricInput("rate", String(out)).ok, `seed ${seed} ${out}`).toBe(false);
    }
  });
});

describe("drafts and edits", () => {
  const groups = metricGroupsOf(WEBINAR);

  it("parseMetricDraft omits blanks and reports errors per field", () => {
    const d = parseMetricDraft(groups, { registrations: "100", attendees: "", revenue: "x" });
    expect(d.values).toEqual({ registrations: 100 });
    expect(Object.keys(d.errors)).toEqual(["revenue"]);
  });

  it("edits keep keys the set does not own and drop cleared fields", () => {
    const existing = { registrations: 10, attendees: 5, legacy_show_rate: 0.4 };
    const merged = mergeMetricEdit(groups, existing, { registrations: 12 });
    expect(merged).toEqual({ legacy_show_rate: 0.4, registrations: 12 });
    expect(otherMetricEntries(groups, merged)).toEqual([["legacy_show_rate", 0.4]]);
    expect(draftFromMetrics(groups, merged)).toEqual({ registrations: "12" });
  });

  it("seeded: an edit never loses a key outside the set", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const existing: Record<string, number> = {};
      for (let i = 0; i < 5; i++) if (r() < 0.6) existing[`old_${i}`] = Math.floor(r() * 50);
      for (const f of groups[0].fields) if (r() < 0.5) existing[f.id] = Math.floor(r() * 50);
      const edited: Record<string, number> = {};
      for (const f of groups[0].fields) if (r() < 0.5) edited[f.id] = Math.floor(r() * 50);
      const merged = mergeMetricEdit(groups, existing, edited);
      for (const [k, v] of Object.entries(existing)) {
        if (k.startsWith("old_")) expect(merged[k], `seed ${seed}`).toBe(v);
      }
      for (const f of groups[0].fields) expect(merged[f.id], `seed ${seed}`).toBe(edited[f.id]);
    }
  });
});

describe("summariseMetrics", () => {
  it("derived rate comes from summed inputs, not the average of weekly rates", () => {
    const rows: ResultMetricsRow[] = [
      { weekStartDate: week(0), metrics: { registrations: 100, attendees: 50 } },
      { weekStartDate: week(1), metrics: { registrations: 10, attendees: 10 } },
    ];
    const s = summariseMetrics(WEBINAR, rows);
    expect(s.entered.registrations).toBe(110);
    expect(s.entered.attendees).toBe(60);
    expect(s.derived.show_up_rate).toBeCloseTo((60 / 110) * 100, 10);
    // The wrong answer: mean of 50% and 100%.
    expect(s.derived.show_up_rate).not.toBeCloseTo(75, 1);
  });

  it("blank weeks are not zeros", () => {
    const s = summariseMetrics(WEBINAR, [
      { weekStartDate: week(0), metrics: { revenue: 100 } },
      { weekStartDate: week(1), metrics: {} },
    ]);
    expect(s.entered.registrations).toBeNull();
    expect(s.derived.show_up_rate).toBeNull();
    expect(s.weeks.revenue).toBe(1);
  });

  it("latest takes the most recent week, whatever the row order", () => {
    const s = summariseMetrics(WEBINAR, [
      { weekStartDate: week(2), metrics: { followers: 300 } },
      { weekStartDate: week(0), metrics: { followers: 100 } },
      { weekStartDate: week(3), metrics: {} },
      { weekStartDate: week(1), metrics: { followers: 200 } },
    ]);
    expect(s.entered.followers).toBe(300);
  });

  it("money sums in cents", () => {
    const s = summariseMetrics(WEBINAR, [
      { weekStartDate: week(0), metrics: { revenue: 0.1 } },
      { weekStartDate: week(1), metrics: { revenue: 0.2 } },
    ]);
    expect(s.entered.revenue).toBe(0.3);
  });

  it("entered rates average only weeks with a value; aggregate falls back to the dictionary", () => {
    const set: InitiativeMetricSet = {
      version: 1, source: { libraryKey: "x", dictionaryVersion: 1 },
      groups: [{ label: null, slug: null, metrics: [
        { key: "watch_rate", label: "Watch rate", kind: "rate", unit: "%", source: "entered", optional: false },
        { key: "list_size", label: "List size", kind: "count", source: "entered", optional: false },
        { key: "nps", label: "NPS", kind: "score", source: "entered", optional: false },
      ] }],
    };
    expect(metricAggregate(set.groups[0].metrics[1])).toBe("latest");
    const s = summariseMetrics(set, [
      { weekStartDate: week(0), metrics: { watch_rate: 40, list_size: 10, nps: 20 } },
      { weekStartDate: week(1), metrics: { list_size: 30 } },
      { weekStartDate: week(2), metrics: { watch_rate: 60, nps: 40 } },
    ]);
    expect(s.entered).toEqual({ watch_rate: 50, list_size: 30, nps: 30 });
  });

  it("seeded: sums, latest and derived-from-sums hold for every random history", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const n = 1 + Math.floor(r() * 8);
      const order = Array.from({ length: n }, (_, i) => i).sort(() => r() - 0.5);
      const rows: ResultMetricsRow[] = order.map((i) => {
        const metrics: Record<string, number> = {};
        if (r() < 0.8) metrics.registrations = Math.floor(r() * 200);
        if (r() < 0.8) metrics.attendees = Math.floor(r() * 200);
        if (r() < 0.6) metrics.followers = Math.floor(r() * 1000);
        return { weekStartDate: week(i), metrics };
      });
      const s = summariseMetrics(WEBINAR, rows);
      const vals = (k: string) => rows.map((x) => x.metrics?.[k]).filter((v): v is number => typeof v === "number");
      const sum = (k: string) => (vals(k).length ? vals(k).reduce((a, b) => a + b, 0) : null);
      expect(s.entered.registrations, `seed ${seed}`).toBe(sum("registrations"));
      expect(s.entered.attendees, `seed ${seed}`).toBe(sum("attendees"));
      const withF = rows.filter((x) => typeof x.metrics?.followers === "number")
        .sort((a, b) => new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime());
      expect(s.entered.followers, `seed ${seed}`).toBe(withF.length ? withF[withF.length - 1].metrics!.followers : null);
      const reg = sum("registrations");
      const att = sum("attendees");
      const expected = reg && att !== null ? (att / reg) * 100 : null;
      if (expected === null) expect(s.derived.show_up_rate, `seed ${seed}`).toBeNull();
      else expect(s.derived.show_up_rate!, `seed ${seed}`).toBeCloseTo(expected, 9);
    }
  });

  it("multi-group: each format's rate reads its own inputs", () => {
    const s = summariseMetrics(HYBRID, [
      { weekStartDate: week(0), metrics: { "virtual.registrations": 100, "virtual.attendees": 25, "in_person.registrations": 10, "in_person.attendees": 9 } },
    ]);
    expect(s.derived[metricFieldId("virtual", "show_up_rate")]).toBe(25);
    expect(s.derived[metricFieldId("in_person", "show_up_rate")]).toBe(90);
  });
});

describe("formatMetricValue", () => {
  it("formats per kind", () => {
    expect(formatMetricValue("rate", "%", 12.5)).toBe("12.5%");
    expect(formatMetricValue("rate", "%", 42)).toBe("42.0%");
    expect(formatMetricValue("money", "$", 1200)).toBe("$1,200");
    expect(formatMetricValue("money", "$", 0.42)).toBe("$0.42");
    expect(formatMetricValue("count", undefined, 1200)).toBe("1,200");
    expect(formatMetricValue("count", "minutes", 4.5)).toBe("4.5 minutes");
    expect(formatMetricValue("score", undefined, -12)).toBe("-12");
    expect(formatMetricValue("rate", "%", null)).toBe("—");
  });
});
