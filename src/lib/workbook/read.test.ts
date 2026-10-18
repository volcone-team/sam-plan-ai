import { describe, it, expect } from "vitest";
import {
  loadBenchmarks, loadLibrary, loadTaskTemplates, toLibraryEntry, toLibraryInitiative,
} from "@/lib/workbook/read";
import { passesIndustry, type EligibilityContext } from "@/lib/recommend/eligibility";
import { fakeSupabase, type Row } from "@/lib/workbook/fake-supabase.test-helper";

const PRE_040 = [
  "initiative_key", "workbook_id", "name", "category", "difficulty", "speed_to_results",
  "one_liner", "description", "needs_sales_team", "price_tier", "own_or_ops", "display_order",
];

const lib = (key: string, over: Row = {}): Row => ({
  initiative_key: key, workbook_id: "IN01", name: key, category: "Webinars", difficulty: 2,
  speed_to_results: "Fast", one_liner: null, description: null, needs_sales_team: "NO",
  price_tier: "Mid", own_or_ops: "OWN", display_order: 0, ...over,
});

const tpl = (key: string, name: string, order = 0): Row => ({
  initiative_key: key, task_number: order + 1, name, category: null, lead_days: 10,
  duration_hours: 1, role: null, depends_on: [], notes: null, display_order: order,
});

describe("toLibraryEntry", () => {
  it("defaults every migration-040 field on an old row", () => {
    const e = toLibraryEntry(lib("webinar"));
    expect(e).toMatchObject({
      baseKey: null, speedScore: null, easeScore: null, scoreTotal: null,
      idealIndustries: [], ctaOptions: [], training: [], metricsRaw: null, metrics: null,
    });
  });

  it("reads the new fields", () => {
    const e = toLibraryEntry(lib("webinar-own", {
      base_key: "webinar", speed_score: 5, ease_score: 2, score_total: 17,
      ideal_industries: ["Retail", ""], cta_options: ["Offer"], training: ["T"],
      metrics_raw: "- Opens", metrics: { version: 1, groups: [{ label: null, metrics: [{ key: "opens", label: "Opens", optional: false, source: "entered" }] }], tags: [], unrecognised: [], notes: [] },
    }));
    expect(e).toMatchObject({
      baseKey: "webinar", speedScore: 5, easeScore: 2, scoreTotal: 17,
      idealIndustries: ["Retail"], ctaOptions: ["Offer"], training: ["T"], metricsRaw: "- Opens",
    });
    expect(e.metrics?.version).toBe(1);
    expect(e.metrics?.groups[0].metrics.map((m) => m.key)).toEqual(["opens"]);
  });

  it("reads an array (column default / pre-parse rows) or junk in metrics as null", () => {
    expect(toLibraryEntry(lib("webinar", { metrics: [] })).metrics).toBeNull();
    expect(toLibraryEntry(lib("webinar", { metrics: [{ name: "a" }] })).metrics).toBeNull();
    expect(toLibraryEntry(lib("webinar", { metrics: "garbage" })).metrics).toBeNull();
  });
});

describe("loadLibrary", () => {
  it("reads the new columns when they exist", async () => {
    const db = fakeSupabase({ tables: { wb_initiative_library: [lib("webinar", { ideal_industries: ["Retail"] })] } });
    const [entry] = await loadLibrary(db.client, { includeInactive: true });
    expect(entry.idealIndustries).toEqual(["Retail"]);
  });

  it("falls back to the old columns on a database without 040", async () => {
    const db = fakeSupabase({
      tables: { wb_initiative_library: [lib("webinar")] },
      schema: { wb_initiative_library: PRE_040 },
    });
    const entries = await loadLibrary(db.client, { includeInactive: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ initiativeKey: "webinar", difficulty: 2, idealIndustries: [], baseKey: null });
  });
});

describe("toLibraryInitiative feeds passesIndustry through the typed field", () => {
  const ctx = (industry: string | null): EligibilityContext => ({
    industry, didntWork: [], monthlyBudget: null, hoursPerWeek: null, whoCloses: null, stage: null,
  });

  it("filters on authored industries", () => {
    const i = toLibraryInitiative(toLibraryEntry(lib("webinar", { ideal_industries: ["Retail"] })));
    expect(passesIndustry(i, ctx("Retail")).eligible).toBe(true);
    expect(passesIndustry(i, ctx("E-commerce")).eligible).toBe(false);
  });

  it("is a no-op when none are stored (today's data)", () => {
    const i = toLibraryInitiative(toLibraryEntry(lib("webinar")));
    expect(passesIndustry(i, ctx("E-commerce")).eligible).toBe(true);
  });
});

describe("variant fallback for task templates and benchmarks", () => {
  const tables = () => ({
    wb_initiative_library: [
      lib("webinar"),
      lib("webinar-own", { base_key: "webinar" }),
      lib("hybrid-events"),
      lib("hybrid-events-own", { base_key: "hybrid-events" }),
    ],
    wb_task_templates: [
      tpl("webinar", "Base task A", 0), tpl("webinar", "Base task B", 1),
      tpl("hybrid-events", "Hybrid base"), tpl("hybrid-events-own", "Hybrid own"),
    ],
    wb_benchmarks: [
      { initiative_key: "webinar", metric: "Show rate", conservative: 0.2, moderate: 0.3,
        aggressive: 0.4, unit: "%", is_placeholder: false, rule_of_thumb: null },
    ],
  });

  it("gives a variant with no templates its base's templates", async () => {
    const db = fakeSupabase({ tables: tables() });
    const map = await loadTaskTemplates(db.client, ["webinar-own"]);
    expect(map.get("webinar-own")?.map((t) => t.name)).toEqual(["Base task A", "Base task B"]);
    // Only the requested key comes back.
    expect([...map.keys()]).toEqual(["webinar-own"]);
  });

  it("prefers the variant's own templates", async () => {
    const db = fakeSupabase({ tables: tables() });
    const map = await loadTaskTemplates(db.client, ["hybrid-events-own", "hybrid-events"]);
    expect(map.get("hybrid-events-own")?.map((t) => t.name)).toEqual(["Hybrid own"]);
    expect(map.get("hybrid-events")?.map((t) => t.name)).toEqual(["Hybrid base"]);
  });

  it("leaves base keys and unknown keys as before", async () => {
    const db = fakeSupabase({ tables: tables() });
    const map = await loadTaskTemplates(db.client, ["webinar", "nope"]);
    expect(map.get("webinar")).toHaveLength(2);
    expect(map.has("nope")).toBe(false);
  });

  it("does nothing on a database without base_key (pre-040)", async () => {
    const t = tables();
    const db = fakeSupabase({
      tables: {
        ...t,
        wb_initiative_library: t.wb_initiative_library.map((r) => {
          const rest = { ...r };
          delete rest.base_key;
          return rest;
        }),
      },
      schema: { wb_initiative_library: PRE_040 },
    });
    const map = await loadTaskTemplates(db.client, ["webinar-own"]);
    expect(map.has("webinar-own")).toBe(false);
  });

  it("falls back for benchmarks too, re-keyed to the variant", async () => {
    const db = fakeSupabase({ tables: tables() });
    const map = await loadBenchmarks(db.client, ["webinar-own"]);
    expect(map.get("webinar-own")).toEqual([
      expect.objectContaining({ initiativeKey: "webinar-own", metric: "Show rate", moderate: 0.3 }),
    ]);
  });
});
