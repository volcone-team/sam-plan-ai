/**
 * Parse the workbook's free-text Metrics cell into standard metric keys.
 *
 * Pure and deterministic: same input, same output, no I/O, never throws.
 *
 * LINE RULES, in order:
 *
 *   1. Bullets ("-", "•", "*", "–") and surrounding whitespace are stripped.
 *      Blank lines are skipped.
 *   2. GROUP HEADER: an UNBULLETED line whose letters are all upper-case and
 *      which is not itself a metric ("VIRTUAL", "IN-PERSON"). Lines after it
 *      belong to a group with that label, until the next header. Lines before
 *      any header go in a group with `label: null`. A header can end in ":".
 *   3. NOTE: any other line ending in ":" ("Dependent on channel:"). It is
 *      context for a human, not a metric and not a group: it goes in `notes`
 *      and does NOT start a group, because the lines after it are still the
 *      initiative's metrics, just with a caveat.
 *   4. "(if applicable)" marks the metric optional and is removed.
 *   5. RESOLUTION: the whole phrase is tried as a synonym first (so
 *      "Views/Visits" is one metric, not two). Failing that, the phrase
 *      without other parentheses ("NPS (Net Promoter Score)"). Failing that,
 *      it is split on " and ", " or " and "/" — and accepted ONLY if every
 *      part resolves ("Registrations and ticket sales" gives two metrics).
 *      Anything else goes to `unrecognised`, verbatim minus the bullet.
 *   6. TAGS (dictionary `kind: "tag"`) go to `tags`, never into a group.
 *
 * Within a group metrics are de-duplicated by key, first position kept; a
 * duplicate is optional only if every mention was.
 *
 * DERIVED: per group, every dictionary metric with a formula whose inputs
 * are ALL entered metrics of that group is emitted as `source: "derived"`,
 * after the entered ones, in dictionary order — whether or not the cell
 * listed it. A derivable metric the cell DID list moves there too. One whose
 * inputs are not all present stays entered where it was written.
 *
 * KNOWN LIMIT: a cell has no way to say a line after "IN-PERSON" applies to
 * the whole event, so trailing whole-event metrics (List Growth, Followers in
 * the OPS Hybrid Events row) land in the last group.
 */

import {
  METRICS_BY_KEY,
  METRICS,
  METRICS_DICTIONARY_VERSION,
  formulaInputs,
  resolveMetric,
  type MetricSource,
} from "@/lib/metrics/dictionary";

export interface ParsedMetric {
  key: string;
  label: string;
  optional: boolean;
  source: MetricSource;
}

export interface ParsedMetricGroup {
  label: string | null;
  metrics: ParsedMetric[];
}

export interface ParsedMetrics {
  groups: ParsedMetricGroup[];
  /** Tag keys (dictionary `kind: "tag"`), de-duplicated across the cell. */
  tags: string[];
  /** Lines that resolved to nothing, as written (bullet stripped). */
  unrecognised: string[];
  /** Caveat lines ending in ":", colon removed. */
  notes: string[];
}

/** What ingest stores in wb_initiative_library.metrics (migration 040). */
export interface StoredMetrics extends ParsedMetrics {
  version: number;
}

export const METRICS_PARSER_VERSION = METRICS_DICTIONARY_VERSION;

const EMPTY = (): ParsedMetrics => ({ groups: [], tags: [], unrecognised: [], notes: [] });

const BULLET = /^\s*[-•*–·]+\s*/;
const IF_APPLICABLE = /\(\s*if\s+applicable\s*\)/gi;
const SPLITTER = /\s+(?:and|or)\s+|\s*\/\s*/i;

function isHeader(text: string, bulleted: boolean): boolean {
  if (bulleted) return false;
  const bare = text.replace(/:\s*$/, "");
  const letters = bare.replace(/[^A-Za-z]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase() && resolveMetric(bare) === null;
}

/** Keys for a phrase, or null. See rule 5. */
function resolvePhrase(phrase: string): string[] | null {
  const whole = resolveMetric(phrase);
  if (whole) return [whole];

  const noParens = phrase.replace(/\([^)]*\)/g, " ").trim();
  if (noParens && noParens !== phrase) {
    const k = resolveMetric(noParens);
    if (k) return [k];
  }

  const parts = phrase.split(SPLITTER).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const keys = parts.map(resolveMetric);
    if (keys.every((k): k is string => k !== null)) return keys;
  }
  return null;
}

interface Draft { label: string | null; items: { key: string; optional: boolean }[] }

function finishGroup(draft: Draft): ParsedMetricGroup {
  const present = new Map<string, boolean>(); // key -> optional
  for (const it of draft.items) present.set(it.key, it.optional);

  const isEnteredInput = (k: string): boolean => present.has(k) && !METRICS_BY_KEY.get(k)?.formula;
  const derivable = new Set(
    METRICS.filter((d) => d.formula && formulaInputs(d.formula).every(isEnteredInput)).map((d) => d.key)
  );

  const label = (k: string): string => METRICS_BY_KEY.get(k)?.label ?? k;
  const entered: ParsedMetric[] = draft.items
    .filter((it) => !derivable.has(it.key))
    .map((it) => ({ key: it.key, label: label(it.key), optional: it.optional, source: "entered" }));

  const derived: ParsedMetric[] = METRICS
    .filter((d) => derivable.has(d.key))
    .map((d) => ({
      key: d.key,
      label: d.label,
      // Optional if it was listed as optional, or any input is.
      optional: (present.get(d.key) ?? false) || formulaInputs(d.formula!).some((k) => present.get(k) === true),
      source: "derived",
    }));

  return { label: draft.label, metrics: [...entered, ...derived] };
}

export function parseMetricsCell(raw: string | null | undefined): ParsedMetrics {
  try {
    if (typeof raw !== "string" || raw.trim() === "") return EMPTY();

    const out = EMPTY();
    const drafts: Draft[] = [];
    let current: Draft = { label: null, items: [] };
    const seenUnrecognised = new Set<string>();
    const pushUnrecognised = (s: string) => {
      if (!seenUnrecognised.has(s)) { seenUnrecognised.add(s); out.unrecognised.push(s); }
    };

    for (const line of raw.split(/\r\n|\r|\n/)) {
      const bulleted = BULLET.test(line);
      const text = line.replace(BULLET, "").replace(/\s+/g, " ").trim();
      if (!text) continue;

      if (isHeader(text, bulleted)) {
        if (current.items.length > 0) drafts.push(current);
        current = { label: text.replace(/:\s*$/, "").trim(), items: [] };
        continue;
      }
      if (text.endsWith(":")) {
        const note = text.slice(0, -1).trim();
        if (note && !out.notes.includes(note)) out.notes.push(note);
        continue;
      }

      const optional = /\(\s*if\s+applicable\s*\)/i.test(text);
      const phrase = text.replace(IF_APPLICABLE, " ").replace(/\s+/g, " ").trim();
      const keys = phrase ? resolvePhrase(phrase) : null;
      if (!keys) { pushUnrecognised(text); continue; }

      for (const key of keys) {
        if (METRICS_BY_KEY.get(key)?.kind === "tag") {
          if (!out.tags.includes(key)) out.tags.push(key);
          continue;
        }
        const prior = current.items.find((it) => it.key === key);
        if (prior) prior.optional = prior.optional && optional;
        else current.items.push({ key, optional });
      }
    }
    if (current.items.length > 0) drafts.push(current);

    out.groups = drafts.map(finishGroup);
    return out;
  } catch {
    // Defensive only: nothing above is expected to throw.
    return EMPTY();
  }
}

/** The jsonb value ingest writes. */
export function toStoredMetrics(parsed: ParsedMetrics): StoredMetrics {
  return { version: METRICS_PARSER_VERSION, ...parsed };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Read wb_initiative_library.metrics defensively.
 *
 * Null for the column default `[]`, for any array (pre-task-3 rows) and for
 * anything malformed. Individual malformed metrics or groups are dropped
 * rather than failing the row.
 */
export function readStoredMetrics(value: unknown): StoredMetrics | null {
  if (!isRecord(value) || !Array.isArray(value.groups)) return null;
  const groups: ParsedMetricGroup[] = [];
  for (const g of value.groups) {
    if (!isRecord(g) || !Array.isArray(g.metrics)) continue;
    const metrics: ParsedMetric[] = [];
    for (const m of g.metrics) {
      if (!isRecord(m) || typeof m.key !== "string") continue;
      metrics.push({
        key: m.key,
        label: typeof m.label === "string" ? m.label : (METRICS_BY_KEY.get(m.key)?.label ?? m.key),
        optional: m.optional === true,
        source: m.source === "derived" ? "derived" : "entered",
      });
    }
    groups.push({ label: typeof g.label === "string" ? g.label : null, metrics });
  }
  return {
    version: typeof value.version === "number" ? value.version : 0,
    groups,
    tags: strings(value.tags),
    unrecognised: strings(value.unrecognised),
    notes: strings(value.notes),
  };
}
