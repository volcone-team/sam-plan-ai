import { describe, it, expect } from "vitest";
import { ingestWorkbook, MIGRATION_040_WARNING } from "@/lib/workbook/ingest";
import type { RawSheet } from "@/lib/workbook/parse";
import { fakeSupabase, type Row } from "@/lib/workbook/fake-supabase.test-helper";

/** wb_initiative_library columns before migration 040 (018). */
const PRE_040 = [
  "initiative_key", "workbook_id", "name", "category", "difficulty", "speed_to_results",
  "one_liner", "description", "needs_sales_team", "price_tier", "own_or_ops", "display_order",
];

const HEADERS = [
  "ID", "Initiative Name", "Category", "Training", "Metrics", "One-line description",
  "Longer Description", "Do you need a sales team?", "Primary product price tier",
  "Own / Ops (future)", "Ideal Industries", "Call to Action Options",
  "Speed (S)", "Cost (C)", "Odds (O)", "Revenue (R)", "Ease (E)", "SCORE total",
];
const libRow = (id: string, name: string, own: string, speed: string, ease: string): string[] =>
  [id, name, "Webinars", "Course A", "Signups\nShows", "x", "y", "NO", "Mid", own,
    "Retail, E-commerce", "Offer", speed, "3", "3", "3", ease, String(9 + Number(speed) + Number(ease))];

const SHEETS: RawSheet[] = [
  {
    name: "1. Initiative Library", headers: HEADERS,
    rows: [libRow("IN01", "Live Webinar", "OPS", "5", "4"), libRow("IN01", "Live Webinar", "OWN", "2", "1")],
  },
  {
    name: "2. Benchmarks", headers: ["Initiative", "Metric", "C", "M", "A", "Unit", "Source", "Rule"],
    rows: [["Live Webinar", "Show rate", "20%", "30%", "40%", "%", "first-party", ""]],
  },
  {
    name: "4.1 Task Template Live Webinar", headers: ["", "#", "Task", "Cat", "Lead", "Hours", "Role", "Dep", "Notes"],
    rows: [["", "1", "Book the date", "Plan", "30", "1", "Owner", "", ""]],
  },
];

const libraryInserts = (calls: ReturnType<typeof fakeSupabase>["calls"]): Row[][] =>
  calls.filter((c) => c.table === "wb_initiative_library" && c.op === "insert").map((c) => c.rows ?? []);

describe("ingestWorkbook — with migration 040", () => {
  it("writes the new fields and the derived difficulty / speed", async () => {
    const db = fakeSupabase();
    const result = await ingestWorkbook(SHEETS, db.client);
    expect(result.ok).toBe(true);
    expect(result.warnings).not.toContain(MIGRATION_040_WARNING);

    const rows = db.tables.wb_initiative_library;
    const base = rows.find((r) => r.initiative_key === "webinar")!;
    const variant = rows.find((r) => r.initiative_key === "webinar-own")!;
    expect(base).toMatchObject({
      difficulty: 2, speed_to_results: "Fast", speed_score: 5, ease_score: 4, score_total: 18,
      ideal_industries: ["Retail", "E-commerce"], cta_options: ["Offer"], training: ["Course A"],
      metrics_raw: "Signups\nShows", base_key: null,
    });
    expect(variant).toMatchObject({ difficulty: 5, speed_to_results: "Slow", base_key: "webinar" });
    expect(libraryInserts(db.calls)).toHaveLength(1);
  });

  it("stores the parsed, versioned metrics and warns about unknown tokens", async () => {
    const db = fakeSupabase();
    const result = await ingestWorkbook(SHEETS, db.client);
    const base = db.tables.wb_initiative_library.find((r) => r.initiative_key === "webinar")!;
    expect(base.metrics).toEqual({
      version: 1,
      groups: [{ label: null, metrics: [{ key: "signups", label: "Sign-ups", optional: false, source: "entered" }] }],
      tags: [], unrecognised: ["Shows"], notes: [],
    });
    const notes = result.warnings.filter((w) => w.startsWith("Metrics for"));
    expect(notes).toHaveLength(2); // base and variant share the cell
    expect(notes[0]).toContain('"Shows"');
  });
});

describe("ingestWorkbook — without migration 040", () => {
  it("falls back to the old columns, keeps derived values, and warns", async () => {
    const db = fakeSupabase({ schema: { wb_initiative_library: PRE_040 } });
    const result = await ingestWorkbook(SHEETS, db.client);

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(MIGRATION_040_WARNING);
    expect(result.counts.library).toBe(2);

    const rows = db.tables.wb_initiative_library;
    expect(rows).toHaveLength(2);
    // `metrics` included: it is a 040-only column and must be stripped too.
    for (const r of rows) expect(Object.keys(r).every((k) => PRE_040.includes(k))).toBe(true);
    // Derived before the fallback, so still stored.
    expect(rows.find((r) => r.initiative_key === "webinar")).toMatchObject({ difficulty: 2, speed_to_results: "Fast" });
    // One rejected attempt, one successful retry.
    expect(libraryInserts(db.calls)).toHaveLength(2);
    // The rest of the workbook still lands.
    expect(db.tables.wb_task_templates).toHaveLength(1);
    expect(db.tables.wb_benchmarks).toHaveLength(1);
  });

  it("does not mask other library errors as a missing migration", async () => {
    const db = fakeSupabase({
      failInsert: (table) => (table === "wb_initiative_library" ? { code: "23505", message: "duplicate key" } : null),
    });
    const result = await ingestWorkbook(SHEETS, db.client);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/duplicate key/);
    expect(result.warnings).not.toContain(MIGRATION_040_WARNING);
    expect(libraryInserts(db.calls)).toHaveLength(1);
  });
});

describe("ingestWorkbook — partial failure", () => {
  it("still seeds settings, and says which tables are incomplete", async () => {
    const db = fakeSupabase({
      failInsert: (table) => (table === "wb_task_templates" ? { code: "XX000", message: "boom" } : null),
    });
    const result = await ingestWorkbook(SHEETS, db.client);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/inserting wb_task_templates: boom/);
    const note = result.warnings.find((w) => w.startsWith("Ingest stopped"))!;
    expect(note).toMatch(/while inserting wb_task_templates/);
    expect(note).toMatch(/Fully written: wb_initiative_library, wb_benchmarks\./);
    expect(note).toMatch(/Empty or incomplete: wb_task_templates, wb_ai_context\./);

    // Seeded straight after the library, so the later failure did not skip it.
    expect((db.tables.initiative_settings ?? []).map((r) => r.initiative_key).sort())
      .toEqual(["webinar", "webinar-own"]);
  });
});
