import { describe, it, expect } from "vitest";
import { parseMetricsCell, type ParsedMetrics } from "@/lib/metrics/parse-metrics";
import { METRICS, METRICS_DICTIONARY_VERSION, evaluateFormula, formulaInputs } from "@/lib/metrics/dictionary";
import {
  buildMetricSet,
  computeDerived,
  enteredMetricKeys,
  formulaInWords,
  groupSlug,
  librarySelectables,
  metricFieldId,
  readMetricSet,
  validateMetricSelection,
  type InitiativeMetricSet,
  type MetricSelection,
} from "@/lib/metrics/metric-set";
import {
  defaultLibraryMetricSet,
  libraryMetricsFor,
  resolveLibraryMetricSet,
} from "@/lib/metrics/library-metric-set";

const HYBRID = [
  "VIRTUAL",
  "- Registrations",
  "- Attendees",
  "- Core offer buyers (if applicable)",
  "IN-PERSON",
  "- Registrations",
  "- Attendees",
  "- VIP buyers (if applicable)",
  "- Product category",
].join("\n");

const SINGLE = ["- Registrations", "- Attendees", "- Revenue", "- Cost (if applicable)"].join("\n");

const keysOf = (set: InitiativeMetricSet | null, g = 0) => set?.groups[g]?.metrics.map((m) => m.key) ?? [];

describe("buildMetricSet — examples", () => {
  it("single group: unprefixed keys, derived after entered, snapshot facts", () => {
    const set = buildMetricSet("webinar", parseMetricsCell(SINGLE))!;
    expect(set.version).toBe(1);
    expect(set.source).toEqual({ libraryKey: "webinar", dictionaryVersion: METRICS_DICTIONARY_VERSION });
    expect(set.groups).toHaveLength(1);
    expect(set.groups[0].slug).toBeNull();
    expect(keysOf(set)).toEqual(["registrations", "attendees", "revenue", "cost", "show_up_rate", "profit", "roi"]);
    expect(enteredMetricKeys(set)).toEqual(["registrations", "attendees", "revenue", "cost"]);
    const rate = set.groups[0].metrics.find((m) => m.key === "show_up_rate")!;
    expect(rate).toMatchObject({ kind: "rate", unit: "%", source: "derived", optional: false,
      formula: { numerator: "attendees", denominator: "registrations", multiplier: 100 } });
    expect(set.groups[0].metrics.find((m) => m.key === "revenue")).toMatchObject({ kind: "money", unit: "$" });
  });

  it("unticking an optional input removes the derived metrics that read it", () => {
    const parsed = parseMetricsCell(SINGLE);
    const set = buildMetricSet("webinar", parsed, { excludedOptional: ["cost"] })!;
    expect(keysOf(set)).toEqual(["registrations", "attendees", "revenue", "show_up_rate"]);
  });

  it("multi-group: prefixed field ids, tags excluded, per-format selection", () => {
    const parsed = parseMetricsCell(HYBRID);
    const all = buildMetricSet("hybrid", parsed)!;
    expect(all.groups.map((g) => [g.label, g.slug])).toEqual([["VIRTUAL", "virtual"], ["IN-PERSON", "in_person"]]);
    expect(enteredMetricKeys(all)).toEqual([
      "virtual.registrations", "virtual.attendees", "virtual.core_offer_buyers",
      "in_person.registrations", "in_person.attendees", "in_person.vip_buyers",
    ]);
    expect(all.groups.flatMap((g) => g.metrics).some((m) => m.key === "product_category")).toBe(false);

    const virtualOnly = buildMetricSet("hybrid", parsed, { groupLabels: ["VIRTUAL"] })!;
    expect(virtualOnly.groups).toHaveLength(1);
    expect(virtualOnly.groups[0].slug).toBeNull();
    expect(enteredMetricKeys(virtualOnly)).toEqual(["registrations", "attendees", "core_offer_buyers"]);

    const noBuyers = buildMetricSet("hybrid", parsed, { excludedOptional: ["virtual.core_offer_buyers"] })!;
    expect(keysOf(noBuyers, 0)).toEqual(["registrations", "attendees", "show_up_rate"]);
    expect(keysOf(noBuyers, 1)).toContain("vip_buyers");
  });

  it("returns null when there is nothing to track", () => {
    expect(buildMetricSet("x", null)).toBeNull();
    expect(buildMetricSet("x", parseMetricsCell(""))).toBeNull();
    expect(buildMetricSet("x", parseMetricsCell("- Product category"))).toBeNull();
  });

  it("de-duplicates slugs and names an unlabelled group", () => {
    expect(groupSlug("IN-PERSON")).toBe("in_person");
    expect(groupSlug(null)).toBe("general");
    const parsed: ParsedMetrics = {
      groups: [
        { label: "ONLINE", metrics: [{ key: "views", label: "Views", optional: false, source: "entered" }] },
        { label: "Online", metrics: [{ key: "views", label: "Views", optional: false, source: "entered" }] },
      ],
      tags: [], unrecognised: [], notes: [],
    };
    expect(enteredMetricKeys(buildMetricSet("k", parsed))).toEqual(["online.views", "online_2.views"]);
  });
});

describe("validateMetricSelection", () => {
  const parsed = parseMetricsCell(HYBRID);
  it("accepts known formats and optional entered ids", () => {
    expect(validateMetricSelection(parsed, {})).toBeNull();
    expect(validateMetricSelection(parsed, { groupLabels: ["IN-PERSON"], excludedOptional: ["virtual.core_offer_buyers"] })).toBeNull();
  });
  it("rejects unknown formats, unknown ids, required and derived ids, and no formats", () => {
    expect(validateMetricSelection(parsed, { groupLabels: ["HYBRID"] })).toMatch(/Unknown format/);
    expect(validateMetricSelection(parsed, { excludedOptional: ["core_offer_buyers"] })).toMatch(/Unknown metric/);
    expect(validateMetricSelection(parsed, { excludedOptional: ["virtual.attendees"] })).toMatch(/cannot be removed/);
    expect(validateMetricSelection(parsed, { excludedOptional: ["virtual.conversion_rate"] })).toMatch(/cannot be removed/);
    expect(validateMetricSelection(parsed, { groupLabels: [] })).toMatch(/at least one/);
  });
  it("a single-group library has no formats to choose", () => {
    expect(validateMetricSelection(parseMetricsCell(SINGLE), { groupLabels: ["VIRTUAL"] })).toMatch(/Unknown format/);
    expect(validateMetricSelection(parseMetricsCell(SINGLE), { groupLabels: [] })).toBeNull();
  });
});

describe("readMetricSet", () => {
  it("round-trips a built set and rejects malformed input", () => {
    const set = buildMetricSet("hybrid", parseMetricsCell(HYBRID));
    expect(readMetricSet(JSON.parse(JSON.stringify(set)))).toEqual(set);
    for (const bad of [null, [], "x", 1, {}, { version: 1, source: { libraryKey: "k", dictionaryVersion: 1 }, groups: [] },
      { version: 1, source: { libraryKey: "k", dictionaryVersion: 1 }, groups: [{ label: null, metrics: [{ key: "a" }] }] },
      { version: 1, source: { libraryKey: "k", dictionaryVersion: 1 },
        groups: [{ label: null, metrics: [{ key: "r", label: "R", kind: "rate", source: "derived", optional: false }] }] },
    ]) {
      expect(readMetricSet(bad)).toBeNull();
    }
  });
});

describe("computeDerived and formulaInWords", () => {
  it("computes per group, null on zero denominator", () => {
    const set = buildMetricSet("hybrid", parseMetricsCell(HYBRID));
    const out = computeDerived(set, {
      "virtual.registrations": 200, "virtual.attendees": 50, "virtual.core_offer_buyers": 5,
      "in_person.registrations": 0, "in_person.attendees": 10,
    });
    expect(out["virtual.show_up_rate"]).toBe(25);
    expect(out["virtual.conversion_rate"]).toBe(10);
    expect(out["in_person.show_up_rate"]).toBeNull();
  });
  it("words", () => {
    expect(formulaInWords({ numerator: "attendees", denominator: "registrations", multiplier: 100 })).toBe("Attendees ÷ Registrations");
    expect(formulaInWords({ numerator: "revenue", minus: "cost" })).toBe("Revenue − Cost");
    expect(formulaInWords({ numerator: "revenue", minus: "cost", denominator: "cost" })).toBe("(Revenue − Cost) ÷ Cost");
  });
});

/* ---------------- seeded property loops ---------------- */

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

const ENTERABLE = METRICS.filter((m) => !m.formula && m.kind !== "tag");
// Inputs of formulas, weighted in so derived metrics appear often.
const FORMULA_INPUTS = [...new Set(METRICS.flatMap((m) => (m.formula ? formulaInputs(m.formula) : [])))];
const HEADERS = ["VIRTUAL", "IN-PERSON", "ONLINE", "LOCAL"];

function randomCell(r: () => number): string {
  const lines: string[] = [];
  const groups = 1 + Math.floor(r() * 3);
  const headed = groups > 1 || r() < 0.3;
  for (let g = 0; g < groups; g++) {
    if (headed) lines.push(HEADERS[g]);
    const n = 1 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const key = r() < 0.6
        ? FORMULA_INPUTS[Math.floor(r() * FORMULA_INPUTS.length)]
        : ENTERABLE[Math.floor(r() * ENTERABLE.length)].key;
      const label = METRICS.find((m) => m.key === key)!.label;
      lines.push(`- ${label}${r() < 0.4 ? " (if applicable)" : ""}`);
    }
    if (r() < 0.2) lines.push("- Product category");
  }
  return lines.join("\n");
}

function randomSelection(r: () => number, parsed: ParsedMetrics): MetricSelection {
  const groups = librarySelectables(parsed);
  const formats = groups.filter((g) => g.selectable).map((g) => g.label as string);
  const sel: MetricSelection = {};
  if (formats.length > 0 && r() < 0.6) {
    const chosen = formats.filter(() => r() < 0.6);
    sel.groupLabels = chosen.length > 0 ? chosen : [formats[0]];
  }
  sel.excludedOptional = groups.flatMap((g) =>
    g.metrics.filter((m) => m.optional && m.source === "entered" && r() < 0.5).map((m) => m.id)
  );
  return sel;
}

describe("buildMetricSet — seeded properties", () => {
  const RUNS = 300;

  it("selection is valid, excluded and unselected are gone, required kept, order kept, derived inputs present", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const parsed = parseMetricsCell(randomCell(r));
      const sel = randomSelection(r, parsed);
      expect(validateMetricSelection(parsed, sel), `seed ${seed}`).toBeNull();

      const lib = librarySelectables(parsed);
      const set = buildMetricSet("k", parsed, sel);
      const excluded = new Set(sel.excludedOptional);
      const keptLib = lib.filter((g) => !g.selectable || !sel.groupLabels || sel.groupLabels.includes(g.label as string));

      if (!set) {
        expect(keptLib.every((g) => g.metrics.every((m) => m.optional && excluded.has(m.id) || m.source === "derived")), `seed ${seed}`).toBe(true);
        continue;
      }
      expect(set.groups.map((g) => g.label), `seed ${seed}`).toEqual(
        keptLib.filter((g) => set.groups.some((s) => s.label === g.label)).map((g) => g.label)
      );

      set.groups.forEach((g) => {
        const src = keptLib.find((l) => l.label === g.label)!;
        // Order: a subsequence of the library group.
        const srcKeys = src.metrics.map((m) => m.key);
        let pos = -1;
        for (const m of g.metrics) {
          const at = srcKeys.indexOf(m.key, pos + 1);
          expect(at, `seed ${seed} order`).toBeGreaterThan(pos);
          pos = at;
        }
        // Required entered metrics always present; excluded ones never.
        for (const m of src.metrics) {
          if (m.source !== "entered") continue;
          const present = g.metrics.some((x) => x.key === m.key);
          expect(present, `seed ${seed} ${m.id}`).toBe(!(m.optional && excluded.has(m.id)));
        }
        // Every derived metric's inputs are entered metrics of the same group.
        const enteredKeys = new Set(g.metrics.filter((m) => m.source === "entered").map((m) => m.key));
        for (const m of g.metrics.filter((x) => x.source === "derived")) {
          expect(m.formula, `seed ${seed}`).toBeDefined();
          expect(formulaInputs(m.formula!).every((k) => enteredKeys.has(k)), `seed ${seed} ${m.key}`).toBe(true);
        }
        // Tags never become metrics.
        expect(g.metrics.some((m) => m.kind === "tag")).toBe(false);
      });

      // Field ids unique; prefixed iff 2+ groups.
      const ids = enteredMetricKeys(set);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.includes(".") === set.groups.length >= 2), `seed ${seed}`).toBe(true);

      // Stored and read back unchanged.
      expect(readMetricSet(JSON.parse(JSON.stringify(set)))).toEqual(set);
    }
  });

  it("removing an input removes every derived metric that reads it", () => {
    let checked = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const parsed = parseMetricsCell(randomCell(r));
      const full = buildMetricSet("k", parsed);
      if (!full) continue;
      const lib = librarySelectables(parsed);
      for (const g of lib) {
        for (const input of g.metrics.filter((m) => m.optional && m.source === "entered")) {
          const set = buildMetricSet("k", parsed, { excludedOptional: [input.id] });
          const group = set?.groups.find((x) => x.label === g.label);
          for (const d of g.metrics.filter((m) => m.source === "derived" && m.formula)) {
            const reads = formulaInputs(d.formula!).includes(input.key);
            const present = group?.metrics.some((m) => m.key === d.key) ?? false;
            if (reads) { expect(present, `seed ${seed} ${d.id} without ${input.id}`).toBe(false); checked++; }
            else expect(present, `seed ${seed} ${d.id} kept`).toBe(true);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("computeDerived equals evaluateFormula on each group's own values", () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const set = buildMetricSet("k", parseMetricsCell(randomCell(r)));
      if (!set) continue;
      const values: Record<string, number> = {};
      for (const id of enteredMetricKeys(set)) values[id] = Math.floor(r() * 50);
      const out = computeDerived(set, values);
      for (const g of set.groups) {
        const local: Record<string, number> = {};
        for (const m of g.metrics) if (m.source === "entered") local[m.key] = values[metricFieldId(g.slug, m.key)];
        for (const m of g.metrics.filter((x) => x.source === "derived")) {
          expect(out[metricFieldId(g.slug, m.key)]).toBe(evaluateFormula(m.formula!, local));
        }
      }
    }
  });
});

describe("library metric set resolution", () => {
  const stored = { version: 1, ...parseMetricsCell("- Opens") };
  it("prefers stored metrics, else parses the raw cell, else none", () => {
    expect(libraryMetricsFor({ metrics: stored, metricsRaw: "- Clicks" })?.groups[0].metrics[0].key).toBe("opens");
    expect(libraryMetricsFor({ metrics: null, metricsRaw: "- Clicks" })?.groups[0].metrics[0].key).toBe("clicks");
    expect(libraryMetricsFor({ metrics: null, metricsRaw: null })).toBeNull();
    expect(defaultLibraryMetricSet("k", { metrics: null, metricsRaw: null })).toBeNull();
    expect(defaultLibraryMetricSet("k", { metrics: null, metricsRaw: "- Clicks" })?.groups[0].metrics[0].key).toBe("clicks");
  });
  it("validates a selection before building", () => {
    const entry = { metrics: null, metricsRaw: HYBRID };
    expect(resolveLibraryMetricSet("h", entry, { groupLabels: ["NOPE"] }).ok).toBe(false);
    const ok = resolveLibraryMetricSet("h", entry, { groupLabels: ["IN-PERSON"] });
    expect(ok.ok && ok.metricSet?.groups.map((g) => g.label)).toEqual(["IN-PERSON"]);
    expect(resolveLibraryMetricSet("h", { metrics: null, metricsRaw: null }, { excludedOptional: ["x"] }).ok).toBe(false);
  });
});
