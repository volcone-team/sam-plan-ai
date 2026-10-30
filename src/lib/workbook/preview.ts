/**
 * Admin upload preview: what a workbook WILL do before it is saved.
 *
 * Pure. Takes the parser's output (run in the browser on exactly the sheets
 * that will be POSTed) and turns it into summary counts, warnings grouped
 * under plain-English headings, one display row per library initiative, and a
 * key diff against the live library.
 *
 * The warnings are classified by matching the parser's and ingest's EXISTING
 * message strings — they are not changed here. Where a message carries
 * structure (which key a duplicate got, which listings share an ID), that is
 * extracted into `detail` so the UI can show it as a list instead of a
 * sentence. A message that matches nothing lands in "other", so a new parser
 * warning is never hidden, only ungrouped.
 */

import type { LibraryRow, ParsedWorkbook } from "@/lib/workbook/parse";
import { parseMetricsCell, type ParsedMetrics } from "@/lib/metrics/parse-metrics";
import { metricsWarnings } from "@/lib/workbook/ingest-messages";

export type WarningGroupId =
  | "taskTabs"
  | "headings"
  | "duplicates"
  | "sharedIds"
  | "scores"
  | "metrics"
  | "orphans"
  | "other";

export type WarningDetail =
  | { kind: "heading"; names: string[] }
  | { kind: "nameless"; workbookId: string }
  | { kind: "collapsed"; count: number }
  | {
      kind: "variants";
      name: string;
      baseKey: string;
      firstListing: string;
      variants: { listing: string; key: string; reason: string }[];
    }
  | { kind: "contextDoubled"; keys: string[] }
  | { kind: "sharedId"; workbookId: string; listings: { name: string; key: string }[] }
  | { kind: "score"; name: string; workbookId: string | null; problems: string[] }
  | { kind: "scoreTotal"; name: string; workbookId: string | null; sheetTotal: number; computed: number }
  | { kind: "metrics"; name: string; key: string; unrecognised: string[] }
  | { kind: "orphanTemplates"; keys: string[] }
  | { kind: "orphanBenchmarks"; keys: string[] }
  | { kind: "noTemplate"; count: number; sample: string[] };

export interface WarningItem {
  message: string;
  detail: WarningDetail | null;
  /** Library keys this warning is about, so a row can be flagged. */
  keys: string[];
  /**
   * "parser" / "ingest": a message the server will report too.
   * "preview": a check only the preview makes (orphan benchmarks).
   */
  origin: "parser" | "ingest" | "preview";
}

export interface WarningGroup {
  id: WarningGroupId;
  heading: string;
  items: WarningItem[];
}

export const WARNING_GROUP_HEADINGS: Record<WarningGroupId, string> = {
  taskTabs: "Task tabs to fix: same initiative name on two tabs (kept separate, not merged)",
  headings: "Skipped headings and banners",
  duplicates: "Duplicate names and how each was resolved",
  sharedIds: "IDs shared by different initiatives",
  scores: "Score problems and total mismatches",
  metrics: "Metrics not recognised",
  orphans: "Task templates and benchmarks that don't match the library",
  other: "Other",
};

const GROUP_ORDER: WarningGroupId[] = [
  "taskTabs", "headings", "duplicates", "sharedIds", "scores", "metrics", "orphans", "other",
];

export interface PreviewRow {
  key: string;
  name: string;
  workbookId: string | null;
  ownOrOps: string | null;
  category: string | null;
  scores: {
    speed: number | null; cost: number | null; odds: number | null;
    revenue: number | null; ease: number | null;
  };
  scoreTotal: number | null;
  industries: string[];
  ctaOptions: string[];
  training: string[];
  metricsRaw: string | null;
  metrics: ParsedMetrics;
  enteredMetricCount: number;
  derivedMetricCount: number;
  /** Tag keys from the Metrics cell. */
  tags: string[];
  /** Set on a variant listing: the base key and, when found, the base's name. */
  baseKey: string | null;
  baseName: string | null;
  /** Messages of every warning that names this row. */
  warnings: string[];
}

export interface WorkbookDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface WorkbookPreview {
  counts: {
    initiatives: number;
    variants: number;
    aiContext: number;
    taskTemplates: number;
    benchmarks: number;
    warnings: number;
  };
  warningGroups: WarningGroup[];
  rows: PreviewRow[];
  /** Null when the live keys could not be fetched. */
  diff: WorkbookDiff | null;
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

const quoted = (s: string): string[] => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
const commaList = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const idOrNull = (s: string): string | null => (s === "no ID" ? null : s);

interface Classified {
  group: WarningGroupId;
  detail: WarningDetail | null;
}

/**
 * Which group a warning belongs to, plus any structure it carries. Patterns
 * mirror the exact strings in parse.ts and ingest-messages.ts.
 */
export function classifyWarning(message: string): Classified {
  let m: RegExpExecArray | null;

  // ---- Task tabs sharing a column-A name (parse.ts: kept separate) ----
  if (/has the same initiative name \(".*"\) as ".*"\. It was kept separate as/.test(message)) {
    return { group: "taskTabs", detail: null };
  }

  // ---- Skipped headings and banners ----
  if ((m = /^Initiative Library: "(.*)" has no ID and no other data — treated as a section heading/.exec(message))) {
    return { group: "headings", detail: { kind: "heading", names: [m[1]] } };
  }
  if ((m = /^Initiative Library: row with ID (.+?) has no initiative name — skipped\./.exec(message))) {
    return { group: "headings", detail: { kind: "nameless", workbookId: m[1] } };
  }
  if ((m = /^AI Context: skipped \d+ section heading row\(s\) with no ID: (.*)\.$/.exec(message))) {
    return { group: "headings", detail: { kind: "heading", names: commaList(m[1]) } };
  }

  // ---- Duplicates ----
  if ((m = /^Initiative Library: collapsed (\d+) duplicate rows/.exec(message))) {
    return { group: "duplicates", detail: { kind: "collapsed", count: Number(m[1]) } };
  }
  if ((m = /^Initiative Library: "(.*)" is listed \d+ times with different details\. The first listing \((.*?)\) keeps "([^"]+)"; (.*)\.$/.exec(message))) {
    const variants = [...m[4].matchAll(/\((.*?)\) → "([^"]+)" \[by ([^\]]+)\]/g)].map((v) => ({
      listing: v[1], key: v[2], reason: v[3],
    }));
    return {
      group: "duplicates",
      detail: { kind: "variants", name: m[1], firstListing: m[2], baseKey: m[3], variants },
    };
  }
  if ((m = /^AI Context: more than one row resolved to (.*?) — kept one per initiative/.exec(message))) {
    return { group: "duplicates", detail: { kind: "contextDoubled", keys: commaList(m[1]) } };
  }

  // ---- Shared IDs ----
  if ((m = /^Initiative Library: ID (.+?) is shared by \d+ different listings — (.*)\. Each keeps its own key/.exec(message))) {
    const listings = [...m[2].matchAll(/"([^"]*)" → "([^"]*)"/g)].map((l) => ({ name: l[1], key: l[2] }));
    return { group: "sharedIds", detail: { kind: "sharedId", workbookId: m[1], listings } };
  }

  // ---- Scores ----
  if ((m = /^Library "(.+?)" \(([^)]*)\): sheet SCORE total (\S+) does not match S\+C\+O\+R\+E = (\S+?); using/.exec(message))) {
    return {
      group: "scores",
      detail: {
        kind: "scoreTotal", name: m[1], workbookId: idOrNull(m[2]),
        sheetTotal: Number(m[3]), computed: Number(m[4]),
      },
    };
  }
  if ((m = /^Library "(.+?)" \(([^)]*)\): (.*) — stored as null\.$/.exec(message))) {
    return {
      group: "scores",
      detail: { kind: "score", name: m[1], workbookId: idOrNull(m[2]), problems: m[3].split("; ") },
    };
  }
  if (/^Library ".*": difficulty .* outside 1-5/.test(message)) {
    return { group: "scores", detail: null };
  }

  // ---- Metrics (ingest) ----
  if ((m = /^Metrics for "(.*)" \(([^)]*)\): unrecognised (.*)\. These will not become trackable inputs\.$/.exec(message))) {
    return { group: "metrics", detail: { kind: "metrics", name: m[1], key: m[2], unrecognised: quoted(m[3]) } };
  }

  // ---- Orphans ----
  if ((m = /^Task templates with no matching library entry: (.*)$/.exec(message))) {
    return { group: "orphans", detail: { kind: "orphanTemplates", keys: commaList(m[1]) } };
  }
  // Preview-only message (see buildWorkbookPreview); the parser has no equivalent.
  if ((m = /^Benchmarks with no matching library entry: (.*)$/.exec(message))) {
    return { group: "orphans", detail: { kind: "orphanBenchmarks", keys: commaList(m[1]) } };
  }
  if ((m = /^Library initiatives with no task template: (\d+) \((.*)\)$/.exec(message))) {
    return {
      group: "orphans",
      detail: { kind: "noTemplate", count: Number(m[1]), sample: commaList(m[2]).filter((k) => k !== "...") },
    };
  }

  return { group: "other", detail: null };
}

/** Library keys a warning is about, resolved against the parsed rows. */
function keysFor(detail: WarningDetail | null, library: readonly LibraryRow[]): string[] {
  if (!detail) return [];
  const byNameId = (name: string, id: string | null) =>
    library.filter((r) => r.name === name && (r.workbookId ?? null) === id).map((r) => r.initiativeKey);
  switch (detail.kind) {
    case "variants": return [detail.baseKey, ...detail.variants.map((v) => v.key)];
    case "sharedId": return detail.listings.map((l) => l.key);
    case "score":
    case "scoreTotal": return byNameId(detail.name, detail.workbookId);
    case "metrics": return [detail.key];
    case "contextDoubled": return detail.keys;
    default: return [];
  }
}

/**
 * Group any list of warnings — the preview's, or the server's ingest result.
 * Empty groups are dropped; order is fixed so the screen reads the same way
 * every time.
 */
export function groupWarnings(
  messages: readonly string[],
  library: readonly LibraryRow[] = [],
  origin: (message: string) => WarningItem["origin"] = () => "parser"
): WarningGroup[] {
  const buckets = new Map<WarningGroupId, WarningItem[]>();
  for (const message of messages) {
    const { group, detail } = classifyWarning(message);
    const items = buckets.get(group) ?? [];
    items.push({ message, detail, keys: keysFor(detail, library), origin: origin(message) });
    buckets.set(group, items);
  }
  return GROUP_ORDER
    .filter((id) => (buckets.get(id)?.length ?? 0) > 0)
    .map((id) => ({ id, heading: WARNING_GROUP_HEADINGS[id], items: buckets.get(id)! }));
}

/* ------------------------------------------------------------------ *
 * Diff
 * ------------------------------------------------------------------ */

/**
 * New / removed / unchanged keys against the live library. "Unchanged" means
 * the key survives; its content may still differ.
 */
export function diffKeys(next: readonly string[], current: readonly string[]): WorkbookDiff {
  const nextSet = new Set(next);
  const currentSet = new Set(current);
  return {
    added: [...nextSet].filter((k) => !currentSet.has(k)),
    removed: [...currentSet].filter((k) => !nextSet.has(k)).sort(),
    unchanged: [...nextSet].filter((k) => currentSet.has(k)),
  };
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

export function buildWorkbookPreview(
  parsed: ParsedWorkbook,
  currentKeys?: readonly string[] | null
): WorkbookPreview {
  const library = parsed.library;
  const libraryKeys = new Set(library.map((r) => r.initiativeKey));

  // Benchmarks join by name and land on the base key; the parser does not
  // check them, so the preview does (preview-only, labelled as such).
  const orphanBenchmarkKeys = [...new Set(parsed.benchmarks.map((b) => b.initiativeKey))]
    .filter((k) => !libraryKeys.has(k));
  const previewOnly = orphanBenchmarkKeys.length > 0
    ? [`Benchmarks with no matching library entry: ${orphanBenchmarkKeys.join(", ")}`]
    : [];

  const ingestMessages = metricsWarnings(library);
  const ingestSet = new Set(ingestMessages);
  const previewSet = new Set(previewOnly);
  const all = [...parsed.warnings, ...ingestMessages, ...previewOnly];

  const groups = groupWarnings(all, library, (msg) =>
    previewSet.has(msg) ? "preview" : ingestSet.has(msg) ? "ingest" : "parser");

  const warningsByKey = new Map<string, string[]>();
  for (const g of groups) {
    for (const item of g.items) {
      for (const key of new Set(item.keys)) {
        warningsByKey.set(key, [...(warningsByKey.get(key) ?? []), item.message]);
      }
    }
  }

  const nameByKey = new Map(library.map((r) => [r.initiativeKey, r.name]));
  const rows: PreviewRow[] = library.map((r) => {
    const metrics = parseMetricsCell(r.metricsRaw ?? null);
    const metricList = metrics.groups.flatMap((g) => g.metrics);
    return {
      key: r.initiativeKey,
      name: r.name,
      workbookId: r.workbookId,
      ownOrOps: r.ownOrOps,
      category: r.category,
      scores: {
        speed: r.speedScore ?? null, cost: r.costScore ?? null, odds: r.oddsScore ?? null,
        revenue: r.revenueScore ?? null, ease: r.easeScore ?? null,
      },
      scoreTotal: r.scoreTotal ?? null,
      industries: r.idealIndustries ?? [],
      ctaOptions: r.ctaOptions ?? [],
      training: r.training ?? [],
      metricsRaw: r.metricsRaw ?? null,
      metrics,
      enteredMetricCount: metricList.filter((x) => x.source === "entered").length,
      derivedMetricCount: metricList.filter((x) => x.source === "derived").length,
      tags: metrics.tags,
      baseKey: r.baseKey ?? null,
      baseName: r.baseKey ? nameByKey.get(r.baseKey) ?? null : null,
      warnings: warningsByKey.get(r.initiativeKey) ?? [],
    };
  });

  return {
    counts: {
      initiatives: library.length,
      variants: library.filter((r) => Boolean(r.baseKey)).length,
      aiContext: parsed.aiContext.length,
      taskTemplates: parsed.taskTemplates.length,
      benchmarks: parsed.benchmarks.length,
      warnings: groups.reduce((n, g) => n + g.items.length, 0),
    },
    warningGroups: groups,
    rows,
    diff: currentKeys ? diffKeys(library.map((r) => r.initiativeKey), currentKeys) : null,
  };
}
