/**
 * An initiative's metric set: WHAT a running initiative tracks, frozen at the
 * moment it was created (stored in `initiatives.metric_set`, migration 040).
 *
 * Pure: no I/O, never throws.
 *
 * SNAPSHOT. Labels, kinds, units and formulas are copied from the dictionary
 * into the set, so a later dictionary or workbook change cannot alter what an
 * initiative already in flight records or how its rates are computed.
 *
 * FIELD IDS — how a result stores a value per metric.
 *
 *   - ONE group in the set: the field id is the bare dictionary key
 *     ("attendees"). Compatible with a results `metrics` JSON keyed by key.
 *   - TWO OR MORE groups: the key is prefixed with the group's slug and a dot
 *     ("virtual.attendees", "in_person.attendees"), because a hybrid event
 *     tracks the same metric once per format.
 *
 *   The slug is the group label lower-cased with every run of non-alphanumerics
 *   turned into "_" ("IN-PERSON" -> "in_person"); an unlabelled group is
 *   "general"; a repeated slug gets "_2", "_3". It is stored on the group
 *   (`slug`, null when the set has one group) so readers never recompute it.
 *   Always build ids with `metricFieldId`.
 *
 *   The rule is applied to the BUILT set: a hybrid initiative where the
 *   customer ticked only VIRTUAL has one group and unprefixed keys.
 *
 * SELECTION. The customer picks formats (labelled groups) and may untick
 * optional metrics. Selection ids use the same rule against the LIBRARY's
 * full grouping (`librarySelectables`), so the picker and the server agree.
 * Unlabelled groups are always kept: they are the whole initiative, not a
 * format.
 */

import {
  METRICS_BY_KEY,
  METRICS_DICTIONARY_VERSION,
  evaluateFormula,
  formulaInputs,
  type MetricAggregate,
  type MetricFormula,
  type MetricKind,
  type MetricSource,
} from "@/lib/metrics/dictionary";
import type { ParsedMetrics } from "@/lib/metrics/parse-metrics";

export const METRIC_SET_VERSION = 1;

export interface MetricSetMetric {
  key: string;
  label: string;
  kind: MetricKind;
  unit?: string;
  source: MetricSource;
  optional: boolean;
  /** Present only when `source` is "derived". */
  formula?: MetricFormula;
  /**
   * How weekly values roll up, snapshotted from the dictionary. Optional:
   * sets written before it was added omit it, and readers fall back to the
   * dictionary (`metricAggregate` in result-metrics).
   */
  aggregate?: MetricAggregate;
}

export interface MetricSetGroup {
  label: string | null;
  /** Field-id prefix; null when the set has a single group. See header. */
  slug: string | null;
  metrics: MetricSetMetric[];
}

export interface InitiativeMetricSet {
  version: number;
  source: { libraryKey: string; dictionaryVersion: number };
  groups: MetricSetGroup[];
}

export interface MetricSelection {
  /** Labelled groups to keep. Undefined means all. */
  groupLabels?: readonly string[];
  /** Selection ids (see `librarySelectables`) of optional metrics to drop. */
  excludedOptional?: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Slugs and field ids
 * ------------------------------------------------------------------ */

export function groupSlug(label: string | null): string {
  const s = (label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "general";
}

/** Unique slugs for a list of labels, or all null when there are fewer than two. */
function slugsFor(labels: ReadonlyArray<string | null>): Array<string | null> {
  if (labels.length < 2) return labels.map(() => null);
  const used = new Map<string, number>();
  return labels.map((label) => {
    const base = groupSlug(label);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

/** The id a value is stored under. `slug` is the group's stored slug (null for a single group). */
export function metricFieldId(slug: string | null | undefined, key: string): string {
  return slug ? `${slug}.${key}` : key;
}

/* ------------------------------------------------------------------ *
 * Library view: what the customer can choose
 * ------------------------------------------------------------------ */

export interface SelectableMetric {
  /** Selection id: unique across the library parse. */
  id: string;
  key: string;
  label: string;
  kind: MetricKind;
  unit?: string;
  source: MetricSource;
  optional: boolean;
  formula?: MetricFormula;
}

export interface SelectableGroup {
  label: string | null;
  /** True when the customer may untick this group (a labelled group in a multi-group parse). */
  selectable: boolean;
  metrics: SelectableMetric[];
}

/**
 * The library parse as the customer sees it: tags removed, keys the
 * dictionary does not know removed, dictionary facts attached.
 */
export function librarySelectables(parsed: ParsedMetrics | null | undefined): SelectableGroup[] {
  if (!parsed || !Array.isArray(parsed.groups)) return [];
  const raw = parsed.groups.map((g) => ({
    label: g.label,
    metrics: g.metrics.filter((m) => {
      const def = METRICS_BY_KEY.get(m.key);
      if (!def || def.kind === "tag") return false;
      // A derived metric needs a formula to be derived.
      return m.source !== "derived" || !!def.formula;
    }),
  })).filter((g) => g.metrics.length > 0);

  const slugs = slugsFor(raw.map((g) => g.label));
  return raw.map((g, gi) => ({
    label: g.label,
    selectable: raw.length >= 2 && g.label !== null,
    metrics: g.metrics.map((m) => {
      const def = METRICS_BY_KEY.get(m.key)!;
      return {
        id: metricFieldId(slugs[gi], m.key),
        key: m.key,
        label: def.label,
        kind: def.kind,
        ...(def.unit ? { unit: def.unit } : {}),
        source: m.source,
        optional: m.optional,
        ...(m.source === "derived" && def.formula ? { formula: { ...def.formula } } : {}),
      };
    }),
  }));
}

/**
 * Check a customer selection against the library. Null when valid, else a
 * message. Unknown group labels, unknown ids, and ids of metrics that are
 * not optional entered metrics are all rejected; so is unticking every format.
 */
export function validateMetricSelection(parsed: ParsedMetrics | null | undefined, sel: MetricSelection): string | null {
  const groups = librarySelectables(parsed);
  const labels = new Set(groups.filter((g) => g.selectable).map((g) => g.label as string));

  if (sel.groupLabels !== undefined) {
    for (const l of sel.groupLabels) {
      if (!labels.has(l)) return `Unknown format: ${l}`;
    }
    if (labels.size > 0 && sel.groupLabels.length === 0) return "Choose at least one format.";
  }

  if (sel.excludedOptional !== undefined) {
    const byId = new Map(groups.flatMap((g) => g.metrics.map((m) => [m.id, m] as const)));
    for (const id of sel.excludedOptional) {
      const m = byId.get(id);
      if (!m) return `Unknown metric: ${id}`;
      if (!m.optional || m.source !== "entered") return `${m.label} cannot be removed.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

/**
 * The metric set for a library initiative and a selection. Null when nothing
 * is left to track (no metrics in the library, or all removed).
 *
 * Drops unselected groups and excluded optional metrics, then any derived
 * metric one of whose inputs is no longer an entered metric of its group.
 * Group and metric order are kept. Unknown selection entries are ignored —
 * validate first with `validateMetricSelection`.
 */
export function buildMetricSet(
  libraryKey: string,
  parsed: ParsedMetrics | null | undefined,
  sel: MetricSelection = {}
): InitiativeMetricSet | null {
  const wanted = sel.groupLabels ? new Set(sel.groupLabels) : null;
  const excluded = new Set(sel.excludedOptional ?? []);

  const kept = librarySelectables(parsed)
    .filter((g) => !g.selectable || !wanted || wanted.has(g.label as string))
    .map((g) => {
      const entered = g.metrics.filter((m) => m.source === "entered" && !(m.optional && excluded.has(m.id)));
      const enteredKeys = new Set(entered.map((m) => m.key));
      const metrics = g.metrics.filter((m) =>
        m.source === "entered"
          ? entered.includes(m)
          : !!m.formula && formulaInputs(m.formula).every((k) => enteredKeys.has(k))
      );
      return { label: g.label, metrics };
    })
    .filter((g) => g.metrics.length > 0);

  if (kept.length === 0) return null;
  const slugs = slugsFor(kept.map((g) => g.label));

  return {
    version: METRIC_SET_VERSION,
    source: { libraryKey, dictionaryVersion: METRICS_DICTIONARY_VERSION },
    groups: kept.map((g, gi) => ({
      label: g.label,
      slug: slugs[gi],
      metrics: g.metrics.map((m) => ({
        key: m.key,
        label: m.label,
        kind: m.kind,
        ...(m.unit ? { unit: m.unit } : {}),
        source: m.source,
        optional: m.optional,
        ...(m.formula ? { formula: { ...m.formula } } : {}),
        ...aggregateOf(m.key),
      })),
    })),
  };
}
function aggregateOf(key: string): { aggregate?: MetricAggregate } {
  const a = METRICS_BY_KEY.get(key)?.aggregate;
  return a ? { aggregate: a } : {};
}

/* ------------------------------------------------------------------ *
 * Reading and using
 * ------------------------------------------------------------------ */

const KINDS: readonly MetricKind[] = ["count", "rate", "money", "score", "tag"];
const AGGREGATES: readonly MetricAggregate[] = ["sum", "average", "latest"];
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

function readFormula(v: unknown): MetricFormula | null {
  if (!isRecord(v) || typeof v.numerator !== "string") return null;
  if (!optStr(v.minus) || !optStr(v.denominator)) return null;
  if (v.multiplier !== undefined && (typeof v.multiplier !== "number" || !Number.isFinite(v.multiplier))) return null;
  return {
    numerator: v.numerator,
    ...(v.minus ? { minus: v.minus } : {}),
    ...(v.denominator ? { denominator: v.denominator } : {}),
    ...(typeof v.multiplier === "number" ? { multiplier: v.multiplier } : {}),
  };
}

function readMetric(v: unknown): MetricSetMetric | null {
  if (!isRecord(v) || typeof v.key !== "string" || v.key === "" || typeof v.label !== "string") return null;
  const kind = KINDS.find((k) => k === v.kind);
  if (!kind || (v.source !== "entered" && v.source !== "derived")) return null;
  if (typeof v.optional !== "boolean" || !optStr(v.unit)) return null;
  const aggregate = AGGREGATES.find((a) => a === v.aggregate);
  let formula: MetricFormula | undefined;
  if (v.source === "derived") {
    const f = readFormula(v.formula);
    if (!f) return null;
    formula = f;
  }
  return {
    key: v.key,
    label: v.label,
    kind,
    ...(v.unit ? { unit: v.unit } : {}),
    source: v.source,
    optional: v.optional,
    ...(formula ? { formula } : {}),
    // Tolerant: a missing or unknown aggregate is dropped, not a reason to
    // reject the set (readers fall back to the dictionary).
    ...(aggregate ? { aggregate } : {}),
  };
}

/**
 * Read `initiatives.metric_set`. Null for null, for anything malformed
 * (including any malformed group or metric) and for an empty set.
 */
export function readMetricSet(value: unknown): InitiativeMetricSet | null {
  if (!isRecord(value) || typeof value.version !== "number" || !isRecord(value.source)) return null;
  const { libraryKey, dictionaryVersion } = value.source;
  if (typeof libraryKey !== "string" || typeof dictionaryVersion !== "number") return null;
  if (!Array.isArray(value.groups) || value.groups.length === 0) return null;

  const groups: MetricSetGroup[] = [];
  for (const g of value.groups) {
    if (!isRecord(g) || !Array.isArray(g.metrics)) return null;
    if (g.label !== null && typeof g.label !== "string") return null;
    if (g.slug !== null && g.slug !== undefined && typeof g.slug !== "string") return null;
    const metrics: MetricSetMetric[] = [];
    for (const m of g.metrics) {
      const read = readMetric(m);
      if (!read) return null;
      metrics.push(read);
    }
    groups.push({ label: g.label, slug: typeof g.slug === "string" ? g.slug : null, metrics });
  }
  // Older or hand-edited rows without slugs: apply the rule.
  if (groups.length >= 2 && groups.some((g) => !g.slug)) {
    slugsFor(groups.map((g) => g.label)).forEach((s, i) => { groups[i].slug = s; });
  }
  // Field ids must be unique.
  const ids = groups.flatMap((g) => g.metrics.map((m) => metricFieldId(g.slug, m.key)));
  if (new Set(ids).size !== ids.length) return null;

  return { version: value.version, source: { libraryKey, dictionaryVersion }, groups };
}

/** Field ids of the metrics a user types in, in set order. */
export function enteredMetricKeys(set: InitiativeMetricSet | null | undefined): string[] {
  if (!set) return [];
  return set.groups.flatMap((g) =>
    g.metrics.filter((m) => m.source === "entered").map((m) => metricFieldId(g.slug, m.key))
  );
}

/**
 * Derived values by field id, from entered values by field id. Each group's
 * formulas read that group's values only. Null where an input is missing or
 * the denominator is zero.
 */
export function computeDerived(
  set: InitiativeMetricSet | null | undefined,
  values: Readonly<Record<string, number | null | undefined>>
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!set) return out;
  for (const g of set.groups) {
    const local: Record<string, number | null | undefined> = {};
    for (const m of g.metrics) {
      if (m.source === "entered") local[m.key] = values[metricFieldId(g.slug, m.key)];
    }
    for (const m of g.metrics) {
      if (m.source === "derived" && m.formula) {
        out[metricFieldId(g.slug, m.key)] = evaluateFormula(m.formula, local);
      }
    }
  }
  return out;
}

/**
 * A formula in words: "Attendees ÷ Registrations", "Revenue − Cost",
 * "(Revenue − Cost) ÷ Cost". The ×100 of a percentage is implied by the unit.
 */
export function formulaInWords(f: MetricFormula, labelOf: (key: string) => string = defaultLabel): string {
  const top = f.minus ? `${labelOf(f.numerator)} − ${labelOf(f.minus)}` : labelOf(f.numerator);
  if (!f.denominator) return top;
  return `${f.minus ? `(${top})` : top} ÷ ${labelOf(f.denominator)}`;
}

function defaultLabel(key: string): string {
  return METRICS_BY_KEY.get(key)?.label ?? key;
}
