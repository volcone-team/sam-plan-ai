/**
 * Route decisions for recurring prompts: which initiatives get them, what the
 * GET returns, which instance dates a POST may write, and what each
 * correction choice writes to the initiatives row.
 *
 * SCOPE. New-intake initiatives only (`isNewIntake`):
 *   - kind 'recurring' with a repeat frequency and day-precision dates gets
 *     run placeholders, "Did this run?" prompts and the skip-streak prompt;
 *   - kind 'ongoing' (or its legacy synonym 'evergreen') gets the
 *     four-weeks-without-actuals variant of the correction prompt.
 * Everything else, including every legacy row, gets nothing.
 *
 * Pure: the routes load rows and hand them in; nothing here touches a
 * database or a clock (today is passed in).
 */
import {
  correctionOptions,
  instanceDates,
  isOutcomePromptDue,
  lowerFrequency,
  mergeInstances,
  shouldPromptCorrection,
  splitGoal,
  type CorrectionAction,
  type CorrectionPrompt,
  type MaterialisedInstance,
  type RecurrenceFrequency,
  type RecurrenceTemplate,
  type RecurringInstance,
} from './recurring';
import { RECURRENCE_FREQUENCIES } from '@/lib/intake-v3/library-config';
import {
  horizonSpan,
  isNewIntake,
  isOngoing,
  launchDate,
  ongoingStale,
  schedulePrecision,
  type DatePrecision,
  type ScheduleFields,
} from './schedule';

type DateLike = Date | string | null | undefined;

const FREQUENCIES: readonly RecurrenceFrequency[] = RECURRENCE_FREQUENCIES;

/**
 * Statuses that take an initiative off the calendar (or finish it). Its runs
 * are still listed, but nothing is asked about them: a paused webinar is not
 * "skipped" and should not build a streak.
 */
const QUIET_STATUSES = new Set(['paused', 'retired', 'completed']);

/** The columns every decision here reads, camelCased from an `initiatives` row. */
export interface RecurringRow extends ScheduleFields {
  name: string;
  status: string | null;
  /** initiatives.repeat_frequency (036). */
  repeatFrequency: string | null;
  /** initiatives.attrs (045). The new form stores the frequency here as `repeat_frequency`. */
  attrs: Record<string, unknown>;
  revenueGood: number;
  createdAt: string | null;
  correctionKeptAt: string | null;
}

/** The select list the routes use. Includes the 046 column, so a missing migration fails the select. */
export const RECURRING_ROW_COLUMNS =
  'id, company_id, annual_plan_id, name, kind, status, activation_date, event_date, revenue_close_date, ' +
  'activation_date_precision, event_date_precision, category_id, repeat_frequency, attrs, revenue_good, ' +
  'created_at, correction_kept_at';

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function precision(v: unknown): DatePrecision | null {
  return v === 'day' || v === 'month' ? v : null;
}

export function rowFromDb(raw: Record<string, unknown>): RecurringRow {
  const attrs = raw.attrs;
  const good = Number(raw.revenue_good);
  return {
    name: str(raw.name) ?? 'This initiative',
    kind: str(raw.kind),
    status: str(raw.status),
    activationDate: str(raw.activation_date),
    eventDate: str(raw.event_date),
    revenueCloseDate: str(raw.revenue_close_date),
    activationDatePrecision: precision(raw.activation_date_precision),
    eventDatePrecision: precision(raw.event_date_precision),
    categoryId: str(raw.category_id),
    repeatFrequency: str(raw.repeat_frequency),
    attrs: typeof attrs === 'object' && attrs !== null && !Array.isArray(attrs) ? (attrs as Record<string, unknown>) : {},
    revenueGood: Number.isFinite(good) && good > 0 ? good : 0,
    createdAt: str(raw.created_at),
    correctionKeptAt: str(raw.correction_kept_at),
  };
}

/** An `initiative_instances` row as mergeInstances wants it. */
export function instanceFromDb(raw: Record<string, unknown>): MaterialisedInstance {
  const rev = raw.actual_revenue;
  const n = rev === null || rev === undefined ? null : Number(rev);
  return {
    id: str(raw.id) ?? undefined,
    instanceDate: str(raw.instance_date),
    outcome: str(raw.outcome),
    actualRevenue: n === null || !Number.isFinite(n) ? null : n,
    updatedAt: str(raw.updated_at),
  };
}

function asFrequency(v: unknown): RecurrenceFrequency | null {
  return typeof v === 'string' && (FREQUENCIES as readonly string[]).includes(v) ? (v as RecurrenceFrequency) : null;
}

/**
 * The repeat frequency. The column (036) when set; otherwise
 * `attrs.repeat_frequency`, which is where POST /api/initiatives puts the new
 * form's answer.
 */
export function frequencyOf(row: Pick<RecurringRow, 'repeatFrequency' | 'attrs'>): RecurrenceFrequency | null {
  return asFrequency(row.repeatFrequency) ?? asFrequency(row.attrs.repeat_frequency);
}

export type RecurringScope =
  | { type: 'recurring'; frequency: RecurrenceFrequency; template: RecurrenceTemplate }
  | { type: 'ongoing' }
  | { type: 'none' };

/**
 * Which prompts, if any, this initiative gets.
 *
 * A recurring initiative needs day-precision dates: a month-only or undated
 * one has no day to put a run on (the weekly planner leaves it out for the
 * same reason). The first run is the event date, else the activation date.
 */
export function recurringScope(row: RecurringRow): RecurringScope {
  if (!isNewIntake(row)) return { type: 'none' };
  if (isOngoing(row.kind)) return { type: 'ongoing' };
  if (row.kind !== 'recurring') return { type: 'none' };
  const frequency = frequencyOf(row);
  if (!frequency) return { type: 'none' };
  if (schedulePrecision(row) !== 'day') return { type: 'none' };
  const first = str(row.eventDate) ?? str(row.activationDate);
  if (!first) return { type: 'none' };
  return { type: 'recurring', frequency, template: { frequency, firstEventDate: first.slice(0, 10) } };
}

/* ------------------------------------------------------------------ *
 * Day arithmetic (UTC day numbers on YYYY-MM-DD strings)
 * ------------------------------------------------------------------ */

function dayNum(d: string): number {
  return Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);
}

function maxDay(...ds: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const d of ds) if (d && (best === null || d > best)) best = d;
  return best;
}

function dayOf(v: DateLike): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    const dd = String(v.getDate()).padStart(2, '0');
    return `${v.getFullYear()}-${mm}-${dd}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * The share of an ongoing initiative's Good revenue still ahead of it in the
 * plan year, prorated by days. Its active span is clipped to the year; the
 * part from today on is what it "still carries". Undated: the whole figure.
 */
export function ongoingRemainingRevenue(row: RecurringRow, planYear: number, today: string): number {
  const good = row.revenueGood;
  if (good <= 0) return 0;
  const span = horizonSpan(row);
  if (span === null) return good;
  const yStart = `${planYear}-01-01`;
  const yEnd = `${planYear}-12-31`;
  const start = span.start > yStart ? span.start : yStart;
  const end = span.end !== null && span.end < yEnd ? span.end : yEnd;
  if (end < start) return 0;
  const total = dayNum(end) - dayNum(start) + 1;
  const from = today > start ? today : start;
  const left = Math.max(0, dayNum(end) - dayNum(from) + 1);
  return Math.round((good * left) / total);
}

/* ------------------------------------------------------------------ *
 * GET /api/initiatives/[id]/instances
 * ------------------------------------------------------------------ */

export interface RecurringStateInput {
  row: RecurringRow;
  planYear: number;
  /** initiative_instances rows for this initiative. Only read for 'recurring'. */
  materialised: readonly MaterialisedInstance[];
  /** The latest day an actual covers (results.week_end_date). Only read for 'ongoing'. */
  lastActualDate: string | null;
  /** YYYY-MM-DD. */
  today: string;
}

export interface RecurringState {
  scope: RecurringScope['type'];
  instances: RecurringInstance[];
  duePrompts: RecurringInstance[];
  correction: CorrectionPrompt | null;
}

export function buildRecurringState(input: RecurringStateInput): RecurringState {
  const { row, planYear, today } = input;
  const scope = recurringScope(row);
  const quiet = QUIET_STATUSES.has(row.status ?? '');

  if (scope.type === 'none') return { scope: 'none', instances: [], duePrompts: [], correction: null };

  if (scope.type === 'ongoing') {
    let correction: CorrectionPrompt | null = null;
    // Before launch there is nothing to have logged.
    const launch = launchDate(row);
    if (!quiet && (launch === null || launch <= today)) {
      /**
       * A keep decision restarts the four weeks, the same as an actual would;
       * "we'll ask again" means after another quiet stretch, not tomorrow.
       * With no launch date the clock starts when the row was created, so an
       * undated initiative added yesterday is not called four weeks quiet.
       */
      const ref = maxDay(dayOf(input.lastActualDate), dayOf(row.correctionKeptAt));
      const since = launch ?? dayOf(row.createdAt);
      if (ongoingStale(ref, today, since)) {
        correction = correctionOptions({
          name: row.name,
          remainingRevenue: ongoingRemainingRevenue(row, planYear, today),
          frequency: null,
          perInstanceGoal: 0,
          remainingInstances: 0,
          variant: 'ongoing',
        });
      }
    }
    return { scope: 'ongoing', instances: [], duePrompts: [], correction };
  }

  const instances = mergeInstances(instanceDates(scope.template, planYear), input.materialised, row.revenueGood);
  const duePrompts = quiet ? [] : instances.filter((i) => isOutcomePromptDue(i, today));

  let correction: CorrectionPrompt | null = null;
  if (!quiet && shouldPromptCorrection(instances, row.correctionKeptAt)) {
    const remaining = instances.filter((i) => i.date >= today);
    const lower = lowerFrequency(scope.frequency);
    const lowerRemaining = lower
      ? instanceDates({ ...scope.template, frequency: lower }, planYear).filter((d) => d >= today).length
      : undefined;
    correction = correctionOptions({
      name: row.name,
      remainingRevenue: remaining.reduce((s, i) => s + i.goal, 0),
      frequency: scope.frequency,
      // The per-run share before the last run's remainder.
      perInstanceGoal: instances.length > 0 ? splitGoal(row.revenueGood, instances.length)[0] : 0,
      remainingInstances: remaining.length,
      variant: 'skipped',
      lowerFrequencyRemainingInstances: lowerRemaining,
    });
  }

  return { scope: 'recurring', instances, duePrompts, correction };
}

/* ------------------------------------------------------------------ *
 * POST /api/initiatives/[id]/instances
 * ------------------------------------------------------------------ */

export type Decision<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** May an outcome be recorded for this run? Only for a date the template produces in the plan year. */
export function instanceWriteDecision(
  scope: RecurringScope,
  planYear: number,
  instanceDate: string
): Decision<{ instanceDate: string }> {
  if (scope.type !== 'recurring') {
    return { ok: false, status: 409, error: 'This initiative does not have recurring occurrences.' };
  }
  if (!instanceDates(scope.template, planYear).includes(instanceDate)) {
    return { ok: false, status: 400, error: 'That date is not one of this initiative’s occurrences.' };
  }
  return { ok: true, value: { instanceDate } };
}

/* ------------------------------------------------------------------ *
 * POST /api/initiatives/[id]/correction
 * ------------------------------------------------------------------ */

/**
 * The `initiatives` update for a correction choice.
 *
 *   change-frequency — repeat_frequency one step lower in the canonical
 *                      order (weekly → bi-weekly → monthly → bi-monthly →
 *                      quarterly → semi-annually → annually).
 *                      attrs.repeat_frequency is rewritten too
 *                      when it is set, so the two never disagree.
 *   pause            — status 'paused' (allowed by 001's CHECK).
 *   retire           — status 'retired' (likewise).
 *   keep             — correction_kept_at = now, which restarts the streak.
 */
export function correctionUpdate(
  action: CorrectionAction,
  scope: RecurringScope,
  row: Pick<RecurringRow, 'repeatFrequency' | 'attrs'>,
  nowIso: string
): Decision<Record<string, unknown>> {
  if (scope.type === 'none') {
    return { ok: false, status: 409, error: 'This initiative does not have recurring prompts.' };
  }
  switch (action) {
    case 'change-frequency': {
      const lower = scope.type === 'recurring' ? lowerFrequency(scope.frequency) : null;
      if (!lower) return { ok: false, status: 409, error: 'This initiative cannot run any less often.' };
      const update: Record<string, unknown> = { repeat_frequency: lower };
      if (row.attrs.repeat_frequency !== undefined) update.attrs = { ...row.attrs, repeat_frequency: lower };
      return { ok: true, value: update };
    }
    case 'pause':
      return { ok: true, value: { status: 'paused' } };
    case 'retire':
      return { ok: true, value: { status: 'retired' } };
    case 'keep':
      return { ok: true, value: { correction_kept_at: nowIso } };
  }
}
