/**
 * Recurring instances for new-intake initiatives.
 *
 * ONE INITIATIVE, MANY RUNS. A weekly webinar stays one `initiatives` row
 * (migration 036). Its runs are derived here from the template — frequency,
 * first event date, offset — and only become rows (`initiative_instances`,
 * migration 046) once the user says something about one: it ran, it was
 * skipped, it has not happened yet, or it made money. Until then a run is a
 * PLACEHOLDER computed on the fly, so changing the frequency never leaves a
 * year of stale rows behind.
 *
 * NEVER INFER ZERO. A placeholder nobody touched has no outcome and no actual
 * revenue — not "skipped", not $0. The outcome prompt asks; the skip streak
 * counts only answers the user gave.
 *
 * Pure: no React, no database. Dates are `YYYY-MM-DD` calendar days and the
 * arithmetic runs on UTC day numbers, so no timezone or DST can move a day.
 */
import { formatMoney } from '@/lib/format-money';
import {
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  RECURRENCE_RUNS_PER_YEAR,
  type RecurrenceFrequency,
} from '@/lib/intake-v3/library-config';
import type { DateOnly } from '@/lib/plan-dates';

export type { RecurrenceFrequency };
export type InstanceOutcome = 'ran' | 'skipped' | 'not-yet';
export type InstanceState = 'placeholder' | 'real';

type DateLike = Date | string | null | undefined;

const FREQUENCIES: readonly RecurrenceFrequency[] = RECURRENCE_FREQUENCIES;

/** Day-stepped frequencies: days between runs. */
const DAY_STEP: Readonly<Partial<Record<RecurrenceFrequency, number>>> = Object.freeze({
  weekly: 7,
  'bi-weekly': 14,
});

/** Month-stepped frequencies: calendar months between runs. */
const MONTH_STEP: Readonly<Partial<Record<RecurrenceFrequency, number>>> = Object.freeze({
  monthly: 1,
  'bi-monthly': 2,
  quarterly: 3,
  'semi-annually': 6,
  annually: 12,
});
const OUTCOMES: readonly InstanceOutcome[] = ['ran', 'skipped', 'not-yet'];

/* ------------------------------------------------------------------ *
 * Calendar-day arithmetic on UTC day numbers
 * ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function epochDay(y: number, m1: number, d: number): number {
  return Math.round(Date.UTC(y, m1 - 1, d) / MS_PER_DAY);
}

function fromEpochDay(n: number): DateOnly {
  const d = new Date(n * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${mm}-${dd}`;
}

function daysIn(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

/** A valid calendar day as {y, m, d}, or null. A Date is read on its LOCAL day. */
function ymd(v: DateLike): { y: number; m: number; d: number } | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  const match = DATE_ONLY.exec(v.slice(0, 10));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

function toEpoch(v: DateLike): number | null {
  const p = ymd(v);
  return p ? epochDay(p.y, p.m, p.d) : null;
}

/** Euclidean modulo, so day numbers before 1970 still find their weekday. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/* ------------------------------------------------------------------ *
 * 1. The dates a template produces in a plan year
 * ------------------------------------------------------------------ */

export interface RecurrenceTemplate {
  frequency: RecurrenceFrequency | null | undefined;
  /** The first run. Runs before it never exist, even in its own year. */
  firstEventDate: DateLike;
  /**
   * Whole days added to every run after the cadence places it. 0 (the default)
   * means each run falls on the cadence date itself. Garbage reads as 0.
   */
  eventOffsetDays?: number | null;
}

/**
 * Every event date the template produces inside `planYear` (Jan 1 – Dec 31),
 * ascending.
 *
 * Weekly and bi-weekly runs step 7 and 14 calendar days (UTC day numbers, so
 * DST never shifts a run). Monthly, bi-monthly, quarterly, semi-annual and
 * annual runs step 1, 2, 3, 6 and 12 calendar months.
 *
 * MONTH-END SAFE. Month-stepped runs keep the first run's day of month
 * and clamp it into short months without carrying the clamp forward:
 * Jan 31 → Feb 28 (29 in a leap year) → Mar 31 → Apr 30 → May 31. Each run is
 * computed from the first, never from the previous run, so one short month
 * cannot drift the series.
 *
 * Empty for no frequency, an invalid first date or a non-integer year.
 */
export function instanceDates(template: RecurrenceTemplate, planYear: number): DateOnly[] {
  const { frequency } = template;
  if (!frequency || !FREQUENCIES.includes(frequency)) return [];
  if (!Number.isInteger(planYear)) return [];
  const first = ymd(template.firstEventDate);
  if (!first) return [];
  const rawOffset = template.eventOffsetDays;
  const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;

  const yStart = epochDay(planYear, 1, 1);
  const yEnd = epochDay(planYear, 12, 31);
  const out: DateOnly[] = [];

  const days = DAY_STEP[frequency];
  if (days) {
    const base = epochDay(first.y, first.m, first.d) + offset;
    const k0 = Math.max(0, Math.ceil((yStart - base) / days));
    for (let k = k0; base + days * k <= yEnd; k++) out.push(fromEpochDay(base + days * k));
    return out;
  }

  const step = MONTH_STEP[frequency];
  if (!step) return [];
  // Start a little before the year (the offset can pull a later run back into
  // it) instead of walking every month since the first run.
  const marginMonths = Math.ceil(Math.abs(offset) / 28) + 1;
  const monthsToYear = (planYear - first.y) * 12 - (first.m - 1) - marginMonths;
  const k0 = Math.max(0, Math.floor(monthsToYear / step));
  for (let k = k0; ; k++) {
    const total = first.m - 1 + k * step;
    const y = first.y + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const event = epochDay(y, m, Math.min(first.d, daysIn(y, m))) + offset;
    if (event > yEnd) break;
    if (event >= yStart) out.push(fromEpochDay(event));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. Placeholders merged with the rows the user created
 * ------------------------------------------------------------------ */

/** An `initiative_instances` row, already mapped to camelCase. */
export interface MaterialisedInstance {
  id?: string;
  instanceDate: DateLike;
  outcome?: InstanceOutcome | string | null;
  actualRevenue?: number | null;
  /** When the row was last written; what the skip streak compares to a keep decision. */
  updatedAt?: DateLike;
}

export interface RecurringInstance {
  date: DateOnly;
  state: InstanceState;
  /** Absent until the user answers. Never filled in on their behalf. */
  outcome?: InstanceOutcome;
  /** This run's share of the template's Good revenue. */
  goal: number;
  /** Only what the user logged. Absent or null means unknown, NOT zero. */
  actualRevenue?: number | null;
  id?: string;
  /** The row's updatedAt as given, for comparing against a keep decision. */
  outcomeAt?: string;
}

/**
 * Split a Good figure into `n` per-run goals: whole dollars rounded down on
 * every run but the last, which takes the remainder. The parts always sum to
 * exactly `good` and none is negative.
 */
export function splitGoal(good: number, n: number): number[] {
  if (!Number.isInteger(n) || n <= 0) return [];
  const total = Number.isFinite(good) && good > 0 ? good : 0;
  const base = Math.floor(total / n);
  const parts = new Array<number>(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

/**
 * The year's runs: every computed date plus every row, one entry per calendar
 * day, ascending.
 *
 *   - A date with a row is 'real' and carries the row's outcome and revenue.
 *   - A date without one is a 'placeholder' with no outcome and no revenue.
 *   - A row on a date the template no longer produces (the frequency changed
 *     after the user logged it) is kept as 'real': logged data never vanishes.
 *
 * `templateGood` is split across every entry with `splitGoal`, so the year's
 * goals add back up to the template's Good figure.
 */
export function mergeInstances(
  dates: readonly DateLike[],
  materialisedRows: readonly MaterialisedInstance[],
  templateGood = 0
): RecurringInstance[] {
  const byDate = new Map<DateOnly, RecurringInstance>();

  for (const raw of dates) {
    const n = toEpoch(raw);
    if (n === null) continue;
    const date = fromEpochDay(n);
    if (!byDate.has(date)) byDate.set(date, { date, state: 'placeholder', goal: 0 });
  }

  for (const row of materialisedRows) {
    const n = toEpoch(row.instanceDate);
    if (n === null) continue;
    const date = fromEpochDay(n);
    const existing = byDate.get(date);
    if (existing && existing.state === 'real') continue; // unique(initiative_id, instance_date); first wins
    const inst: RecurringInstance = { date, state: 'real', goal: 0 };
    if (typeof row.outcome === 'string' && (OUTCOMES as readonly string[]).includes(row.outcome)) {
      inst.outcome = row.outcome as InstanceOutcome;
    }
    if (typeof row.actualRevenue === 'number' && Number.isFinite(row.actualRevenue)) {
      inst.actualRevenue = row.actualRevenue;
    } else if (row.actualRevenue === null) {
      inst.actualRevenue = null;
    }
    if (row.id) inst.id = row.id;
    if (row.updatedAt instanceof Date && !isNaN(row.updatedAt.getTime())) inst.outcomeAt = row.updatedAt.toISOString();
    else if (typeof row.updatedAt === 'string' && row.updatedAt !== '') inst.outcomeAt = row.updatedAt;
    byDate.set(date, inst);
  }

  const list = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const goals = splitGoal(templateGood, list.length);
  list.forEach((inst, i) => {
    inst.goal = goals[i];
  });
  return list;
}

/* ------------------------------------------------------------------ *
 * 3. When to ask "did it run?"
 * ------------------------------------------------------------------ */

/** Days from a week's Monday to the Friday of the following week. */
const MONDAY_TO_NEXT_FRIDAY = 11;

/**
 * The day the outcome prompt for a run becomes due: the Friday of the week
 * after the run's week, weeks starting on Monday. A Tuesday 2026-03-03 run
 * (week of Mon 03-02) is asked about on Friday 2026-03-13; so is a run on
 * Sunday 03-08, the last day of that week. Null for an invalid date.
 */
export function promptDueDate(instanceDate: DateLike): DateOnly | null {
  const n = toEpoch(instanceDate);
  if (n === null) return null;
  // Day 0 (1970-01-01) was a Thursday, so (n + 3) mod 7 is days since Monday.
  const monday = n - mod(n + 3, 7);
  return fromEpochDay(monday + MONDAY_TO_NEXT_FRIDAY);
}

/**
 * Should the user be asked about this run today? Only for a placeholder
 * nobody has touched (no outcome, no revenue), from its due Friday onward.
 * Anything the user has already answered is never asked about again.
 */
export function isOutcomePromptDue(
  instance: Pick<RecurringInstance, 'date' | 'state' | 'outcome' | 'actualRevenue'>,
  today: DateLike
): boolean {
  if (instance.state !== 'placeholder') return false;
  if (instance.outcome !== undefined) return false;
  if (instance.actualRevenue !== undefined && instance.actualRevenue !== null) return false;
  const due = promptDueDate(instance.date);
  const t = toEpoch(today);
  if (due === null || t === null) return false;
  return t >= (toEpoch(due) as number);
}

/* ------------------------------------------------------------------ *
 * 4. Skip streak and the correction prompt
 * ------------------------------------------------------------------ */

/** Four skips in a row means the plan, not the user, is probably wrong. */
export const CORRECTION_STREAK = 4;

/** Milliseconds for a date-only (local midnight) or a full timestamp. */
function timeOf(v: DateLike): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  const p = DATE_ONLY.test(v) ? ymd(v) : null;
  if (p) return new Date(p.y, p.m - 1, p.d).getTime();
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

/**
 * How many of the most recent ANSWERED runs were skipped, back to the first
 * answer that was not a skip ('ran' or 'not-yet'). Runs without an answer are
 * not counted either way — silence is not a skip.
 *
 * `lastKeptAt` is when the user last chose "Keep it as planned". Only answers
 * given after it count, so keeping resets the streak and the prompt returns
 * after four more skips. An answer's time is the row's `outcomeAt` when known,
 * else the run's own date.
 */
export function skipStreak(instances: readonly RecurringInstance[], lastKeptAt?: DateLike): number {
  const kept = timeOf(lastKeptAt);
  const answered = instances
    .filter(i => i.outcome !== undefined)
    .filter(i => {
      if (kept === null) return true;
      const t = timeOf(i.outcomeAt) ?? timeOf(i.date);
      return t !== null && t > kept;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let streak = 0;
  for (const i of answered) {
    if (i.outcome !== 'skipped') break;
    streak++;
  }
  return streak;
}

export function shouldPromptCorrection(instances: readonly RecurringInstance[], lastKeptAt?: DateLike): boolean {
  return skipStreak(instances, lastKeptAt) >= CORRECTION_STREAK;
}

/* ------------------------------------------------------------------ *
 * 5. The correction prompt's copy and what each choice does to the plan
 * ------------------------------------------------------------------ */

export type CorrectionAction = 'change-frequency' | 'pause' | 'retire' | 'keep';

export interface CorrectionOption {
  action: CorrectionAction;
  label: string;
  detail: string;
  /** Only on 'change-frequency'. */
  newFrequency?: RecurrenceFrequency;
  /** Rest-of-year revenue the plan carries after this choice. */
  planRevenueAfter: number;
  /** planRevenueAfter minus the current rest-of-year revenue; 0 or negative. */
  delta: number;
}

export interface CorrectionPrompt {
  heading: string;
  body: string;
  options: CorrectionOption[];
  dismissLabel: string;
}

export interface CorrectionInput {
  name: string;
  /** Revenue the initiative still carries for the rest of the year. */
  remainingRevenue: number;
  frequency?: RecurrenceFrequency | null;
  perInstanceGoal: number;
  /** Runs left this year at the current frequency. */
  remainingInstances: number;
  /** 'ongoing' for an always-on initiative that has gone quiet (see ongoingStale). */
  variant?: 'skipped' | 'ongoing';
  /**
   * Runs left this year at the lower frequency, when the caller has computed
   * them from real dates (instanceDates). Without it the count is scaled from
   * `remainingInstances` by runs per year and rounded.
   */
  lowerFrequencyRemainingInstances?: number;
}

const RUNS_PER_YEAR: Readonly<Record<RecurrenceFrequency, number>> = RECURRENCE_RUNS_PER_YEAR;

function money(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The next lower frequency in the canonical order (weekly → bi-weekly →
 * monthly → bi-monthly → quarterly → semi-annually → annually), or null for
 * annually / none / an unknown value.
 */
export function lowerFrequency(f: RecurrenceFrequency | null | undefined): RecurrenceFrequency | null {
  if (!f) return null;
  const i = FREQUENCIES.indexOf(f);
  return i >= 0 && i < FREQUENCIES.length - 1 ? FREQUENCIES[i + 1] : null;
}

export function correctionOptions(input: CorrectionInput): CorrectionPrompt {
  const remaining = money(input.remainingRevenue);
  const x = formatMoney(remaining);
  const heading =
    input.variant === 'ongoing'
      ? `${input.name} hasn't logged anything in four weeks.`
      : `${input.name} has been skipped four times in a row.`;
  const body =
    "That usually means the plan is wrong, not that you're behind. " +
    `It's still carrying ${x} for the rest of the year. Pick what's true and the plan will catch up.`;

  const drop = remaining === 0 ? 0 : -remaining; // never -0
  const options: CorrectionOption[] = [];
  const current = input.frequency && FREQUENCIES.includes(input.frequency) ? input.frequency : null;
  const lower = lowerFrequency(current);
  if (current && lower) {
    const override = input.lowerFrequencyRemainingInstances;
    const runs =
      typeof override === 'number' && Number.isFinite(override) && override >= 0
        ? Math.trunc(override)
        : Math.round((Math.max(0, input.remainingInstances || 0) * RUNS_PER_YEAR[lower]) / RUNS_PER_YEAR[current]);
    const after = money(input.perInstanceGoal) * runs;
    options.push({
      action: 'change-frequency',
      label: 'Change the frequency',
      detail: `${RECURRENCE_FREQUENCY_LABELS[lower]} instead of ${RECURRENCE_FREQUENCY_LABELS[current].toLowerCase()}. Plan goes to ${formatMoney(after)}`,
      newFrequency: lower,
      planRevenueAfter: after,
      delta: after - remaining,
    });
  }
  options.push(
    {
      action: 'pause',
      label: 'Pause it',
      detail: `Comes off the calendar until you turn it back on. Plan drops ${x}`,
      planRevenueAfter: 0,
      delta: drop,
    },
    {
      action: 'retire',
      label: 'Retire it for this year',
      detail: `Off the plan. Plan drops ${x}`,
      planRevenueAfter: 0,
      delta: drop,
    },
    {
      action: 'keep',
      label: 'Keep it as planned',
      detail: "Nothing changes. We'll ask again after four more",
      planRevenueAfter: remaining,
      delta: 0,
    }
  );

  return { heading, body, options, dismissLabel: 'Not now' };
}
