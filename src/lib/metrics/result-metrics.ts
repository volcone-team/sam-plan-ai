/**
 * Weekly results against an initiative's metric set: which fields to show,
 * how typed text becomes a stored number, how weeks roll up, and how values
 * are shown. Pure: no I/O, never throws.
 *
 * STORAGE. `results.metrics` is a JSON object keyed by field id
 * (`metricFieldId`). Only ENTERED metrics are stored; derived metrics are
 * always recomputed, so a corrected input can never leave a stale rate.
 * A blank field is OMITTED, never stored as 0: "not recorded" and "zero"
 * are different facts.
 *
 * RATES are stored as PERCENTAGES (0–100), the same scale as the dictionary
 * unit "%" and as derived rates (`pct` formulas multiply by 100). The user
 * types 12.5 for 12.5%; 12.5 is stored; it is shown as "12.5%".
 *
 * LEGACY. An initiative without a metric set keeps the old behaviour: its
 * fields are the initiative type's benchmark keys, unchanged.
 */
import { METRICS_BY_KEY, type MetricAggregate, type MetricKind } from "@/lib/metrics/dictionary";
import {
  computeDerived,
  formulaInWords,
  metricFieldId,
  type InitiativeMetricSet,
  type MetricSetMetric,
} from "@/lib/metrics/metric-set";
import { formatMoney, formatMoneyPrecise, formatNumber } from "@/lib/format-money";

/* ------------------------------------------------------------------ *
 * Fields
 * ------------------------------------------------------------------ */

export interface MetricField {
  id: string;
  label: string;
  kind: MetricKind;
  unit?: string;
  optional: boolean;
}

export interface DerivedField {
  id: string;
  label: string;
  kind: MetricKind;
  unit?: string;
  /** "Attendees ÷ Registrations". */
  formulaText: string;
}

export interface MetricFieldGroup {
  /** Null for an unlabelled group. */
  label: string | null;
  fields: MetricField[];
  derived: DerivedField[];
}

export type MetricFields =
  | { mode: "set"; set: InitiativeMetricSet; groups: MetricFieldGroup[] }
  | { mode: "legacy"; keys: string[] };

/** The groups of a set as input fields and derived read-outs. */
export function metricGroupsOf(set: InitiativeMetricSet): MetricFieldGroup[] {
  return set.groups.map((g) => {
    const labelOf = (key: string) =>
      g.metrics.find((m) => m.key === key)?.label ?? METRICS_BY_KEY.get(key)?.label ?? key;
    return {
      label: g.label,
      fields: g.metrics
        .filter((m) => m.source === "entered")
        .map((m) => ({
          id: metricFieldId(g.slug, m.key),
          label: m.label,
          kind: m.kind,
          ...(m.unit ? { unit: m.unit } : {}),
          optional: m.optional,
        })),
      derived: g.metrics
        .filter((m) => m.source === "derived" && m.formula)
        .map((m) => ({
          id: metricFieldId(g.slug, m.key),
          label: m.label,
          kind: m.kind,
          ...(m.unit ? { unit: m.unit } : {}),
          formulaText: formulaInWords(m.formula!, labelOf),
        })),
    };
  });
}

/**
 * What the Results tab and planner render for an initiative. With a metric
 * set: its groups. Without: the legacy benchmark keys, exactly as given.
 */
export function metricFieldsFor(
  initiative: { metricSet?: InitiativeMetricSet | null } | null | undefined,
  legacyKeys: readonly string[]
): MetricFields {
  const set = initiative?.metricSet;
  if (set) return { mode: "set", set, groups: metricGroupsOf(set) };
  return { mode: "legacy", keys: [...legacyKeys] };
}

/** Every entered field id of a field list. */
export function enteredFieldIds(groups: readonly MetricFieldGroup[]): string[] {
  return groups.flatMap((g) => g.fields.map((f) => f.id));
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export type NormalisedMetric =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * Typed text -> the number to store. `value: null` means blank (omit it).
 *
 *   count  non-negative whole number
 *   money  non-negative, rounded to cents
 *   rate   0–100, a percentage (see header)
 *   score  any finite number (NPS runs −100..100)
 *   tag    never numeric: always an error
 *
 * Commas and surrounding spaces are ignored ("1,200" is 1200); a trailing
 * "%" on a rate and a leading "$" on money are accepted.
 */
export function normaliseMetricInput(kind: MetricKind, raw: string | null | undefined): NormalisedMetric {
  let text = (raw ?? "").replace(/,/g, "").trim();
  if (text === "") return { ok: true, value: null };
  if (kind === "tag") return { ok: false, error: "This metric is not a number." };
  if (kind === "rate") text = text.replace(/%$/, "").trim();
  if (kind === "money") text = text.replace(/^\$/, "").trim();
  if (!NUMERIC.test(text)) return { ok: false, error: "Enter a number." };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number." };
  switch (kind) {
    case "count":
      if (n < 0) return { ok: false, error: "Cannot be negative." };
      if (!Number.isInteger(n)) return { ok: false, error: "Enter a whole number." };
      return { ok: true, value: n };
    case "money":
      if (n < 0) return { ok: false, error: "Cannot be negative." };
      return { ok: true, value: Math.round(n * 100) / 100 };
    case "rate":
      if (n < 0 || n > 100) return { ok: false, error: "Enter a percentage from 0 to 100." };
      return { ok: true, value: n };
    case "score":
      return { ok: true, value: n };
  }
}

export interface MetricDraft {
  /** Valid, non-blank values by field id: what to store. */
  values: Record<string, number>;
  /** Error message by field id. Empty when the draft is valid. */
  errors: Record<string, string>;
}

/** Validate every field of a form. Fields absent from `raw` are blank. */
export function parseMetricDraft(
  groups: readonly MetricFieldGroup[],
  raw: Readonly<Record<string, string>>
): MetricDraft {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const f of groups.flatMap((g) => g.fields)) {
    const r = normaliseMetricInput(f.kind, raw[f.id]);
    if (!r.ok) errors[f.id] = r.error;
    else if (r.value !== null) values[f.id] = r.value;
  }
  return { values, errors };
}

/** Stored values -> form text, for editing. Only fields of the set. */
export function draftFromMetrics(
  groups: readonly MetricFieldGroup[],
  metrics: Readonly<Record<string, unknown>> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of enteredFieldIds(groups)) {
    const v = metrics?.[id];
    if (typeof v === "number" && Number.isFinite(v)) out[id] = String(v);
  }
  return out;
}

/**
 * The metrics object to save when editing a result: every key the set does
 * NOT own is kept exactly as stored (older keys, keys of another set), then
 * the set's fields are replaced by the edited values. A field cleared in the
 * form is removed. Nothing outside the set can be lost by an edit.
 */
export function mergeMetricEdit(
  groups: readonly MetricFieldGroup[],
  existing: Readonly<Record<string, number>> | null | undefined,
  edited: Readonly<Record<string, number>>
): Record<string, number> {
  const owned = new Set(enteredFieldIds(groups));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(existing ?? {})) {
    if (!owned.has(k)) out[k] = v;
  }
  for (const [k, v] of Object.entries(edited)) {
    if (owned.has(k)) out[k] = v;
  }
  return out;
}

/** Stored keys the set does not own, in stored order: "Other recorded metrics". */
export function otherMetricEntries(
  groups: readonly MetricFieldGroup[],
  metrics: Readonly<Record<string, unknown>> | null | undefined
): Array<[string, number]> {
  const owned = new Set(enteredFieldIds(groups));
  return Object.entries(metrics ?? {}).filter(
    (e): e is [string, number] => !owned.has(e[0]) && typeof e[1] === "number" && Number.isFinite(e[1])
  );
}

/** A stored key as words: "in_person.attendees" -> "in person: Attendees". */
export function otherMetricLabel(id: string): string {
  const dot = id.lastIndexOf(".");
  const key = dot >= 0 ? id.slice(dot + 1) : id;
  const label = METRICS_BY_KEY.get(key)?.label ?? key.replace(/_/g, " ");
  return dot >= 0 ? `${id.slice(0, dot).replace(/_/g, " ")}: ${label}` : label;
}

/* ------------------------------------------------------------------ *
 * Roll-up across weeks
 * ------------------------------------------------------------------ */

/**
 * How a metric rolls up: the snapshot's aggregate, else the dictionary's
 * (sets written before the snapshot carried it), else by kind.
 */
export function metricAggregate(m: Pick<MetricSetMetric, "key" | "kind" | "aggregate">): MetricAggregate {
  // An entered rate is a level, never a quantity: summing weekly rates is
  // meaningless, so it averages whatever a snapshot says. Scores follow the
  // dictionary (NPS averages; search rating is "latest").
  const a = m.aggregate ?? METRICS_BY_KEY.get(m.key)?.aggregate;
  if (m.kind === "rate") return "average";
  if (a) return a;
  return m.kind === "score" ? "average" : "sum";
}

export interface ResultMetricsRow {
  weekStartDate: Date | string;
  metrics: Readonly<Record<string, unknown>> | null | undefined;
}

export interface MetricsSummary {
  /** Rolled-up entered values by field id; null when no week has a value. */
  entered: Record<string, number | null>;
  /** Derived values recomputed from the rolled-up inputs. */
  derived: Record<string, number | null>;
  /** Weeks that recorded each entered field. */
  weeks: Record<string, number>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const time = (d: Date | string): number => {
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * An initiative's metrics across all its weeks.
 *
 *   sum      totalled (money in cents, so $0.10 + $0.20 is $0.30)
 *   latest   the value of the most recent week (by weekStartDate) that has one
 *   average  mean of the weeks that have a value; blank weeks do not count
 *
 * Derived metrics are recomputed from the ROLLED-UP inputs via
 * `computeDerived`: total attendees ÷ total registrations, not the average
 * of weekly show-up rates, which is wrong whenever weeks differ in size.
 */
export function summariseMetrics(
  set: InitiativeMetricSet | null | undefined,
  results: readonly ResultMetricsRow[]
): MetricsSummary {
  const entered: Record<string, number | null> = {};
  const weeks: Record<string, number> = {};
  if (!set) return { entered, derived: {}, weeks };
  for (const g of set.groups) {
    for (const m of g.metrics) {
      if (m.source !== "entered") continue;
      const id = metricFieldId(g.slug, m.key);
      const present = results
        .map((r) => ({ t: time(r.weekStartDate), v: num(r.metrics?.[id]) }))
        .filter((x): x is { t: number; v: number } => x.v !== null);
      weeks[id] = present.length;
      if (present.length === 0) { entered[id] = null; continue; }
      const agg = metricAggregate(m);
      if (agg === "latest") {
        // Most recent week; ties keep the later row, so input order breaks them.
        entered[id] = present.reduce((best, x) => (x.t >= best.t ? x : best)).v;
      } else if (agg === "sum") {
        entered[id] = m.kind === "money"
          ? present.reduce((s, x) => s + Math.round(x.v * 100), 0) / 100
          : present.reduce((s, x) => s + x.v, 0);
      } else {
        entered[id] = present.reduce((s, x) => s + x.v, 0) / present.length;
      }
    }
  }
  return { entered, derived: computeDerived(set, entered), weeks };
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

const oneDecimal = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/**
 * A metric value for reading. Null is "—".
 *   rate   12.5%           (one decimal)
 *   money  $1,200 / $0.42  (cents shown only when there are cents)
 *   count  1,200           (averages keep one decimal: 4.5)
 *   score  any, one decimal
 * A unit other than "$" or "%" is appended: "4.5 minutes".
 */
export function formatMetricValue(kind: MetricKind, unit: string | undefined, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (kind === "rate") return `${value.toFixed(1)}%`;
  if (kind === "money") {
    return Math.round(value * 100) % 100 === 0 ? formatMoney(value) : formatMoneyPrecise(value);
  }
  const text = Number.isInteger(value) ? formatNumber(value) : oneDecimal(value);
  return unit && unit !== "$" && unit !== "%" ? `${text} ${unit}` : text;
}

/** "Registrations", "Revenue ($)", "Show-up rate (%)", "Viewing time (minutes)". */
export function fieldLabelWithUnit(f: { label: string; unit?: string }): string {
  return f.unit ? `${f.label} (${f.unit})` : f.label;
}
