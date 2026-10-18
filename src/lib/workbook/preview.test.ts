import { describe, it, expect } from "vitest";
import { parseWorkbook, type RawSheet } from "@/lib/workbook/parse";
import { MIGRATION_040_WARNING } from "@/lib/workbook/ingest-messages";
import {
  buildWorkbookPreview, classifyWarning, diffKeys, groupWarnings, type WarningGroupId,
} from "@/lib/workbook/preview";

/**
 * Every warning below is produced by the REAL parser from synthetic sheets, so
 * the preview's patterns are checked against the strings parse.ts emits, not
 * hand-copied ones that could drift. Layout mirrors parse-scored-layout.test.ts.
 */
const HEADERS = [
  "ID", "Initiative Name", "Category", "Training", "Metrics",
  "One-line description", "Longer Description", "Do you need a sales team?",
  "Primary product price tier", "Own / Ops (future)", "Ideal Industries", "Call to Action Options",
  "Speed (S)\n5 = really fast", "Cost (C)\n5 = low cost", "Odds (O)\n5 = near certain",
  "Revenue (R)\n5 = great", "Ease (E)\n5 = easy", "SCORE total\nmax 25", "Weighted SCORE",
];

interface Lib {
  id?: string; name?: string; category?: string; metrics?: string; long?: string;
  own?: string; industries?: string; scores?: string[]; total?: string;
}
const lib = (r: Lib): string[] => [
  r.id ?? "", r.name ?? "", r.category ?? "", "", r.metrics ?? "",
  "Short", r.long ?? "Longer", "NO", "Mid", r.own ?? "OWN", r.industries ?? "", "",
  ...(r.scores ?? ["3", "3", "3", "3", "3"]), r.total ?? "15", "#REF!",
];
const label = (text: string, width = HEADERS.length): string[] =>
  Array.from({ length: width }, (_, i) => (i === 1 ? text : ""));
const sheet = (name: string, headers: string[], rows: string[][]): RawSheet =>
  ({ name, headers, rows, rowCount: rows.length });

const CTX_HEADERS = ["ID", "Initiative", "When to recommend it", "Best-fit audience",
  "Min. assets needed", "Why it works", "What to avoid", "Sequencing notes"];
const TPL_HEADERS = ["Initiative", "Task #", "Task Name", "Category", "Lead", "Duration", "Role", "Depends", "Notes"];
const BENCH_HEADERS = ["Initiative", "Metric", "Conservative", "Moderate", "Aggressive", "Unit", "Source", "Rule"];

const SHEETS: RawSheet[] = [
  sheet("1. Initiative Library", HEADERS, [
    label("DIGITAL MARKETING"),
    lib({ id: "IN01", name: "Live Webinar", own: "OPS", metrics: "- Registrations\n- Attendees", industries: "Retail, Health, Coaching" }),
    lib({ id: "IN01", name: "Live Webinar", own: "OWN", long: "Hosted" }),
    lib({ id: "IN07", name: "Organic Social", metrics: "- Moonbeams\n- Followers" }),
    lib({ id: "IN07", name: "Content" }),
    lib({ id: "IN08", name: "Referrals", scores: ["5", "4", "4", "4", "4"], total: "20" }),
    lib({ id: "IN04", name: "Paid Ads", scores: ["3", "", "7", "3", "2"], total: "12" }),
    lib({ id: "IN12", name: "Online Workshops", category: "A" }),
    lib({ id: "IN12", name: "Online Workshops", category: "A" }),
    lib({ id: "IN99" }),
  ]),
  sheet("3. AI Context", CTX_HEADERS, [
    label("Sales Team", CTX_HEADERS.length),
    ["IN01", "Live Webinar", "When", "", "", "", "", ""],
  ]),
  sheet("4.1 Task Template Webinar", TPL_HEADERS, [
    ["Live Webinar", "1", "Pick a date", "", "30", "1", "", "", ""],
    ["Live Webinar", "2", "Write slides", "", "20", "4", "", "1", ""],
  ]),
  sheet("4.2 Task Template Moon Landing", TPL_HEADERS, [
    ["Moon Landing", "1", "Build rocket", "", "400", "100", "", "", ""],
    ["Moon Landing", "2", "Launch", "", "1", "1", "", "1", ""],
  ]),
  sheet("2. Benchmarks", BENCH_HEADERS, [
    ["Live Webinar", "Show rate", "30%", "40%", "50%", "%", "Placeholder", ""],
    ["Mars Colony", "Show rate", "30%", "40%", "50%", "%", "", ""],
  ]),
];

const parsed = parseWorkbook(SHEETS);
const preview = buildWorkbookPreview(parsed, ["webinar", "referrals", "dinners-lunches"]);
const group = (id: WarningGroupId) => preview.warningGroups.find((g) => g.id === id);
const details = (id: WarningGroupId) => (group(id)?.items ?? []).map((i) => i.detail);

describe("warning groups, from real parser strings", () => {
  it("puts every parser warning in exactly one group", () => {
    const grouped = preview.warningGroups.flatMap((g) => g.items.map((i) => i.message));
    for (const w of parsed.warnings) expect(grouped.filter((m) => m === w)).toHaveLength(1);
  });

  it("skipped headings and nameless rows", () => {
    expect(details("headings")).toEqual(expect.arrayContaining([
      { kind: "heading", names: ["DIGITAL MARKETING"] },
      { kind: "nameless", workbookId: "IN99" },
      { kind: "heading", names: ["Sales Team"] },
    ]));
  });

  it("duplicates, with how each variant was resolved", () => {
    expect(details("duplicates")).toEqual(expect.arrayContaining([
      { kind: "collapsed", count: 1 },
      {
        kind: "variants", name: "Live Webinar", baseKey: "webinar",
        firstListing: "IN01, OPS, DIGITAL MARKETING",
        variants: [{ listing: "IN01, OWN, DIGITAL MARKETING", key: "webinar-own", reason: "Own/Ops" }],
      },
    ]));
  });

  it("shared IDs, listing each key", () => {
    expect(details("sharedIds")).toEqual([{
      kind: "sharedId", workbookId: "IN07",
      listings: [{ name: "Organic Social", key: "organic-social" }, { name: "Content", key: "content" }],
    }]);
  });

  it("score problems and total mismatches", () => {
    expect(details("scores")).toEqual(expect.arrayContaining([
      { kind: "scoreTotal", name: "Referrals", workbookId: "IN08", sheetTotal: 20, computed: 21 },
      { kind: "score", name: "Paid Ads", workbookId: "IN04", problems: ["Cost blank", "Odds 7 is outside 1-5"] },
    ]));
  });

  it("unrecognised metrics, per initiative, with the ingest wording", () => {
    const items = group("metrics")!.items;
    expect(items).toHaveLength(1);
    expect(items[0].origin).toBe("ingest");
    expect(items[0].message.startsWith('Metrics for "Organic Social" (organic-social)')).toBe(true);
    expect(items[0].detail).toEqual({
      kind: "metrics", name: "Organic Social", key: "organic-social", unrecognised: ["Moonbeams"],
    });
  });

  it("orphan task templates, missing templates and orphan benchmarks", () => {
    expect(details("orphans")).toEqual(expect.arrayContaining([
      { kind: "orphanTemplates", keys: ["moon-landing"] },
      expect.objectContaining({ kind: "noTemplate" }),
      { kind: "orphanBenchmarks", keys: ["mars-colony"] },
    ]));
    const bench = group("orphans")!.items.find((i) => i.detail?.kind === "orphanBenchmarks")!;
    expect(bench.origin).toBe("preview");
  });

  it("anything unmatched goes to other", () => {
    // Lead time > 365 days on the Moon Landing template.
    expect(group("other")!.items.some((i) => /lead time 400 exceeds 365 days/.test(i.message))).toBe(true);
    expect(classifyWarning(MIGRATION_040_WARNING).group).toBe("other");
    expect(classifyWarning("Something new the parser says").group).toBe("other");
  });

  it("flags the rows a warning names", () => {
    const row = (k: string) => preview.rows.find((r) => r.key === k)!;
    expect(row("referrals").warnings.some((w) => /does not match/.test(w))).toBe(true);
    expect(row("webinar-own").warnings.some((w) => /listed 2 times/.test(w))).toBe(true);
    expect(row("organic-social").warnings.length).toBeGreaterThanOrEqual(2); // shared ID + metrics
    expect(row("online-workshops").warnings).toEqual([]);
  });

  it("groups the server's ingest warnings the same way", () => {
    const groups = groupWarnings([MIGRATION_040_WARNING, ...parsed.warnings]);
    expect(groups.map((g) => g.id)).toEqual(["headings", "duplicates", "sharedIds", "scores", "orphans", "other"]);
  });
});

describe("rows and counts", () => {
  it("counts what will be stored", () => {
    expect(preview.counts).toEqual({
      initiatives: parsed.library.length,
      variants: 1,
      aiContext: parsed.aiContext.length,
      taskTemplates: parsed.taskTemplates.length,
      benchmarks: 2,
      warnings: preview.warningGroups.reduce((n, g) => n + g.items.length, 0),
    });
  });

  it("marks variants with their base", () => {
    const variant = preview.rows.find((r) => r.key === "webinar-own")!;
    expect(variant.baseKey).toBe("webinar");
    expect(variant.baseName).toBe("Live Webinar");
    expect(preview.rows.find((r) => r.key === "webinar")!.baseKey).toBeNull();
  });

  it("counts entered and derived metrics", () => {
    const row = preview.rows.find((r) => r.key === "webinar")!;
    expect(row.enteredMetricCount).toBe(2);
    expect(row.derivedMetricCount).toBe(1); // show-up rate from registrations + attendees
    expect(row.industries).toEqual(["Retail", "Health", "Coaching"]);
  });
});

describe("diff against the live library", () => {
  it("splits keys into added, removed and unchanged", () => {
    expect(preview.diff!.unchanged).toEqual(["webinar", "referrals"]);
    expect(preview.diff!.removed).toEqual(["dinners-lunches"]);
    expect(preview.diff!.added).toContain("webinar-own");
    expect(preview.diff!.added).not.toContain("webinar");
  });

  it("is null when the live keys are unavailable", () => {
    expect(buildWorkbookPreview(parsed).diff).toBeNull();
    expect(buildWorkbookPreview(parsed, null).diff).toBeNull();
  });

  it("treats an empty live library as all new", () => {
    expect(diffKeys(["a", "b"], [])).toEqual({ added: ["a", "b"], removed: [], unchanged: [] });
  });
});
