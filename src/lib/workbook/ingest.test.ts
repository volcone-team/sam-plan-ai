import { describe, it, expect } from "vitest";
import {
  ingestWorkbook,
  MIGRATION_040_WARNING,
  MIGRATION_051_COLUMNS,
  MIGRATION_051_WARNING,
  nextLibraryColumnSet,
  shapeLibraryRow,
} from "@/lib/workbook/ingest";
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
    // Rejected with 051, rejected again without it, then lands without 040 too.
    expect(libraryInserts(db.calls)).toHaveLength(3);
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

/* ── Migration 051: raw Frequency / Allowed Frequencies cells ───────────── */

const HEADERS_051 = [...HEADERS, "Frequency", "Allowed Frequencies"];
const SHEETS_051: RawSheet[] = [
  {
    ...SHEETS[0],
    headers: HEADERS_051,
    rows: [
      [...libRow("IN01", "Live Webinar", "OPS", "5", "4"), "Once, Recurring", "Monthly, Quarterly"],
      [...libRow("IN01", "Live Webinar", "OWN", "2", "1"), "Evergreen", "n/a"],
    ],
  },
  ...SHEETS.slice(1),
];

/** Every column 040 knows, i.e. a database with 040 applied but not 051. */
const PRE_051 = [
  ...PRE_040, "base_key", "speed_score", "cost_score", "odds_score", "revenue_score", "ease_score",
  "score_total", "ideal_industries", "cta_options", "training", "metrics_raw", "metrics",
];

describe("ingestWorkbook — migration 051", () => {
  it("writes the raw Frequency / Allowed Frequencies cells when the columns exist", async () => {
    const db = fakeSupabase();
    const result = await ingestWorkbook(SHEETS_051, db.client);
    expect(result.ok).toBe(true);
    expect(result.warnings).not.toContain(MIGRATION_051_WARNING);
    const rows = db.tables.wb_initiative_library;
    expect(rows.find((r) => r.initiative_key === "webinar")).toMatchObject({
      allowed_kinds_raw: "Once, Recurring", allowed_frequencies_raw: "Monthly, Quarterly",
    });
    expect(rows.find((r) => r.initiative_key === "webinar-own")).toMatchObject({
      allowed_kinds_raw: "Evergreen", allowed_frequencies_raw: "n/a",
    });
    expect(libraryInserts(db.calls)).toHaveLength(1);
  });

  it("before 051: retries without the two columns, keeps the 040 ones, and still succeeds", async () => {
    const db = fakeSupabase({ schema: { wb_initiative_library: PRE_051 } });
    const result = await ingestWorkbook(SHEETS_051, db.client);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(MIGRATION_051_WARNING);
    expect(result.warnings).not.toContain(MIGRATION_040_WARNING);
    const rows = db.tables.wb_initiative_library;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).not.toHaveProperty("allowed_kinds_raw");
      expect(r).not.toHaveProperty("allowed_frequencies_raw");
    }
    expect(rows.find((r) => r.initiative_key === "webinar")).toMatchObject({ speed_score: 5 });
    expect(libraryInserts(db.calls)).toHaveLength(2);
  });

  it("does not warn about 051 when the workbook has no frequency cells", async () => {
    const db = fakeSupabase({ schema: { wb_initiative_library: PRE_051 } });
    const result = await ingestWorkbook(SHEETS, db.client);
    expect(result.ok).toBe(true);
    expect(result.warnings).not.toContain(MIGRATION_051_WARNING);
  });
});

describe("nextLibraryColumnSet — the retry decision", () => {
  const missing = { code: "PGRST204", message: "Could not find the 'allowed_kinds_raw' column" };
  const undefinedColumn = { code: "42703", message: "column does not exist" };

  it("drops 051 first, then 040, then gives up", () => {
    expect(nextLibraryColumnSet({ m040: true, m051: true }, missing)).toEqual({ m040: true, m051: false });
    expect(nextLibraryColumnSet({ m040: true, m051: false }, undefinedColumn)).toEqual({ m040: false, m051: false });
    expect(nextLibraryColumnSet({ m040: false, m051: false }, missing)).toBeNull();
  });

  it("never retries an error that is not a missing column", () => {
    expect(nextLibraryColumnSet({ m040: true, m051: true }, { code: "23505", message: "duplicate key" })).toBeNull();
    expect(nextLibraryColumnSet({ m040: true, m051: true }, null)).toBeNull();
  });

  it("shapeLibraryRow strips exactly the dropped groups", () => {
    const row = { initiative_key: "k", speed_score: 3, metrics: {}, allowed_kinds_raw: "Once", allowed_frequencies_raw: null };
    expect(shapeLibraryRow(row, { m040: true, m051: true })).toEqual(row);
    expect(Object.keys(shapeLibraryRow(row, { m040: true, m051: false }))).toEqual(["initiative_key", "speed_score", "metrics"]);
    expect(Object.keys(shapeLibraryRow(row, { m040: false, m051: false }))).toEqual(["initiative_key"]);
    expect(MIGRATION_051_COLUMNS).toEqual(["allowed_kinds_raw", "allowed_frequencies_raw"]);
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
