/**
 * Recurring initiatives: where the occurrences stop, and what each earns.
 *
 * Client, Oct 2026 (initiative overview transcript):
 *   - "If something's monthly, we need it to anticipate there's going to be 12
 *     in the plan" — the series runs from the FIRST occurrence (event_date) to
 *     the LAST occurrence, not to the cart / revenue close date. The close date
 *     used to end the whole series, so a monthly webinar whose cart closed
 *     three days after the first one had exactly one occurrence.
 *   - "They think I'm going to make $75,000 per webinar, not in total" —
 *     revenue is entered PER OCCURRENCE. revenue_good stays the plan total
 *     (per occurrence x occurrences) because every total already sums it.
 *
 * Stored in initiatives.last_occurrence_date / revenue_per_occurrence
 * (migration 061). Before 061 is applied the values live in attrs under the
 * same names, exactly like attrs.repeat_frequency before 051; readers take the
 * column first, then attrs.
 */
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import { toDateOnly, type DateOnly } from "@/lib/plan-dates";

type Row = Record<string, unknown>;
type WriteError = { code?: string | null; message?: string | null } | null;
type WriteResult = { error: WriteError };

export const LAST_OCCURRENCE_ATTR = "last_occurrence_date";
export const PER_OCCURRENCE_ATTR = "revenue_per_occurrence";
/**
 * Every initiatives column migration 061 adds. On a database without them the
 * write keeps each value in attrs under the same name, so nothing is lost.
 */
export const MIGRATION_061_COLUMNS: readonly string[] = Object.freeze([
  LAST_OCCURRENCE_ATTR,
  PER_OCCURRENCE_ATTR,
  "units_goal",
  "unit_price_at_set",
  "target_source",
]);

/** The words, identical on Add, Edit and the Overview. */
export const OCCURRENCE_COPY = Object.freeze({
  first: "First occurrence",
  firstHint: "The date of the first one, e.g. your first webinar.",
  last: "Last occurrence",
  lastHint: "When the occurrences end. Defaults to the end of your plan.",
  perOccurrence: "per occurrence",
  closeHint: "For each occurrence. It no longer ends the series; the last occurrence does.",
});

type DateLike = Date | string | null | undefined;

function day(v: DateLike): DateOnly | null {
  if (v === null || v === undefined || v === "") return null;
  const s = toDateOnly(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function amount(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

export interface OccurrenceFields {
  lastOccurrenceDate?: DateLike;
  revenuePerOccurrence?: number | string | null;
  attrs?: Readonly<Record<string, unknown>> | null;
}

/** The last occurrence: the column, else attrs (before 061). Null = until the plan ends. */
export function lastOccurrenceOf(i: OccurrenceFields): DateOnly | null {
  return day(i.lastOccurrenceDate) ?? day(i.attrs?.[LAST_OCCURRENCE_ATTR] as DateLike);
}

/** Good for one occurrence, when it was recorded: the column, else attrs. */
export function perOccurrenceOf(i: OccurrenceFields): number | null {
  return amount(i.revenuePerOccurrence) ?? amount(i.attrs?.[PER_OCCURRENCE_ATTR]);
}

/* ------------------------------------------------------------------ *
 * Moving one occurrence (attrs only, no migration)
 * ------------------------------------------------------------------ */

/**
 * attrs key for per-occurrence date moves: `{ [scheduledDate]: movedDate }`.
 * The schedule is still calculated from the first occurrence and the
 * frequency; a move replaces only the one date it is keyed by. A key the
 * schedule no longer produces (the first occurrence or frequency changed) is
 * ignored, so a moved date never survives a reschedule by accident.
 */
export const OCCURRENCE_OVERRIDES_ATTR = "occurrence_overrides";

/** The valid moves on an initiative, scheduled date -> moved date. */
export function occurrenceOverridesOf(i: OccurrenceFields): Record<DateOnly, DateOnly> {
  const raw = i.attrs?.[OCCURRENCE_OVERRIDES_ATTR];
  if (!isObject(raw)) return {};
  const out: Record<DateOnly, DateOnly> = {};
  for (const [from, to] of Object.entries(raw)) {
    const f = day(from);
    const t = day(to as DateLike);
    if (f && t && f !== t) out[f] = t;
  }
  return out;
}

/**
 * attrs with one occurrence moved (`to` = the new date) or put back on its
 * scheduled date (`to` = null or the scheduled date). Other attrs and other
 * moves are kept. Pure.
 */
export function withOccurrenceOverride(
  attrs: Readonly<Record<string, unknown>> | null | undefined,
  scheduled: DateOnly,
  to: DateOnly | null
): Record<string, unknown> {
  const base: Row = isObject(attrs) ? { ...attrs } : {};
  const moves: Row = isObject(base[OCCURRENCE_OVERRIDES_ATTR]) ? { ...(base[OCCURRENCE_OVERRIDES_ATTR] as Row) } : {};
  const target = to === null ? null : day(to);
  if (target === null || target === scheduled) delete moves[scheduled];
  else moves[scheduled] = target;
  if (Object.keys(moves).length > 0) base[OCCURRENCE_OVERRIDES_ATTR] = moves;
  else delete base[OCCURRENCE_OVERRIDES_ATTR];
  return base;
}

/** The default last occurrence for a plan year: 31 December. Null without a year. */
export function defaultLastOccurrence(planYear: number | null | undefined): DateOnly | null {
  return typeof planYear === "number" && Number.isInteger(planYear) && planYear >= 1000 && planYear <= 9999
    ? `${planYear}-12-31`
    : null;
}

/** Per occurrence x occurrences, rounded to the cent. */
export function totalForOccurrences(perOccurrence: number, occurrences: number): number {
  const n = Number.isFinite(occurrences) && occurrences >= 1 ? Math.floor(occurrences) : 1;
  return Math.round(perOccurrence * n * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * Writing before migration 061 is applied
 * ------------------------------------------------------------------ */

/**
 * An `initiatives` insert/update payload with the 061 columns moved into
 * attrs, or null when it carries none. `baseAttrs` is the row's current attrs
 * for an UPDATE (attrs is replaced wholesale).
 */
export function occurrenceColumnsFallback(row: Row, baseAttrs?: Row | null): Row | null {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(row, k);
  if (!MIGRATION_061_COLUMNS.some(has)) return null;
  const attrs: Row = {
    ...(isObject(baseAttrs) ? baseAttrs : {}),
    ...(isObject(row.attrs) ? row.attrs : {}),
  };
  const out: Row = { ...row };
  for (const key of MIGRATION_061_COLUMNS) {
    if (!has(key)) continue;
    if (row[key] === null || row[key] === undefined) delete attrs[key];
    else attrs[key] = row[key];
    delete out[key];
  }
  out.attrs = attrs;
  return out;
}

let warned = false;

/**
 * Run a write; when a 061 column does not exist, retry once with the values in
 * attrs. Any other error is returned untouched.
 */
export async function withOccurrenceFallback<R extends WriteResult>(
  payload: Row,
  run: (payload: Row) => PromiseLike<R>,
  label: string,
  baseAttrs?: () => Promise<Row | null>
): Promise<R> {
  const first = await run(payload);
  if (!first.error || !isMissingColumnError(first.error)) return first;
  const retry = occurrenceColumnsFallback(payload, baseAttrs ? await baseAttrs() : null);
  if (retry === null) return first;
  if (!warned) {
    warned = true;
    console.warn(
      `${label} last_occurrence_date / revenue_per_occurrence missing (migration 061 not applied?); ` +
        "keeping them in attrs.",
      first.error?.message ?? ""
    );
  }
  return run(retry);
}
