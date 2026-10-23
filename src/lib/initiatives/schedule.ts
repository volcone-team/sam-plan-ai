/**
 * Schedule rules for initiatives: when one is "in" a period, where its tasks
 * anchor, when its revenue closes, how the calendar draws it, and whether it
 * has dates at all.
 *
 * TWO GENERATIONS OF ROW, ONE MODULE.
 *
 *   Legacy rows (everything created before the new intake) always have an
 *   activation_date, day-precision dates, no revenue_close_date and no
 *   category_id. Every rule below has a LEGACY branch that is a literal copy of
 *   what the readers did before this module existed, so those rows behave
 *   exactly as they did. The regression tests pin that.
 *
 *   New-intake rows (migration 045) may have no activation_date, month-only
 *   dates (stored as the 1st, `*_date_precision = 'month'`), no event date
 *   (ongoing — stored as kind 'evergreen', the legacy synonym), and a
 *   revenue_close_date that, per the 045 column comment, governs when the
 *   initiative leaves the active view — explicitly NOT the event date.
 *
 * A row is treated as new-intake only when one of the 045 signals is present
 * (see `isNewIntake`). With all of them at their defaults the legacy branch
 * runs, so nothing changes for a row the new form did not write.
 *
 * Pure: no React, no database. Dates go through plan-dates.ts so a calendar
 * day stays the same calendar day in every timezone.
 */
import { addDays, daysInMonth, parseDateOnly, toDateOnly, todayDateOnly, type DateOnly } from '@/lib/plan-dates';

export type DatePrecision = 'day' | 'month';
type DateLike = Date | string | null | undefined;

/** The fields every rule here reads. Matches `Initiative` and raw-ish rows alike. */
export interface ScheduleFields {
  kind?: string | null;
  activationDate?: DateLike;
  eventDate?: DateLike;
  revenueCloseDate?: DateLike;
  activationDatePrecision?: DatePrecision | null;
  eventDatePrecision?: DatePrecision | null;
  categoryId?: string | null;
}

/** A valid calendar day, or null for absent / unparseable input. */
function day(v: DateLike): DateOnly | null {
  if (v === null || v === undefined || v === '') return null;
  const s = toDateOnly(v);
  return s ? s : null;
}

/** First / last calendar day of the month a date falls in. */
function monthStart(d: DateOnly): DateOnly {
  return `${d.slice(0, 7)}-01`;
}
function monthEnd(d: DateOnly): DateOnly {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return `${d.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** 'ongoing' is the contract word; 'evergreen' its legacy synonym (migration 045 §6c). */
export function isOngoing(kind: string | null | undefined): boolean {
  return kind === 'ongoing' || kind === 'evergreen';
}

/**
 * Does this row carry any of the migration 045 schedule signals? Only then do
 * the new rules apply. A NULL activation_date is itself a signal: before 045
 * the column was NOT NULL, so only the new form can have written one.
 */
export function isNewIntake(i: ScheduleFields): boolean {
  return (
    (typeof i.categoryId === 'string' && i.categoryId !== '') ||
    day(i.revenueCloseDate) !== null ||
    i.activationDatePrecision === 'month' ||
    i.eventDatePrecision === 'month' ||
    day(i.activationDate) === null
  );
}

/* ------------------------------------------------------------------ *
 * Precision and the unscheduled state
 * ------------------------------------------------------------------ */

/**
 * How precisely this initiative is dated.
 *
 *   'unscheduled' — neither an activation nor an event date.
 *   'month'       — at least one of its dates is known only to the month.
 *   'day'         — every date it has is an exact day.
 *
 * Legacy rows are always 'day'.
 */
export type SchedulePrecision = 'day' | 'month' | 'unscheduled';

export function schedulePrecision(i: ScheduleFields): SchedulePrecision {
  const a = day(i.activationDate);
  const e = day(i.eventDate);
  if (a === null && e === null) return 'unscheduled';
  if ((a !== null && i.activationDatePrecision === 'month') || (e !== null && i.eventDatePrecision === 'month')) {
    return 'month';
  }
  return 'day';
}

/** No activation and no event date: captured, but not on any calendar. */
export function isUnscheduled(i: ScheduleFields): boolean {
  return schedulePrecision(i) === 'unscheduled';
}

/** Month-only or undated: cannot be placed on a day, so not yet schedulable. */
export function needsDates(i: ScheduleFields): boolean {
  return schedulePrecision(i) !== 'day';
}

export function countNeedingDates(list: readonly ScheduleFields[]): number {
  return list.reduce((n, i) => n + (needsDates(i) ? 1 : 0), 0);
}

/** The plan-level notice, or null when there is nothing to say. */
export function needsDatesNotice(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1
    ? '1 initiative needs dates before it can be scheduled.'
    : `${count} initiatives need dates before they can be scheduled.`;
}

/* ------------------------------------------------------------------ *
 * The horizon: launch -> retirement
 * ------------------------------------------------------------------ */

/** When the initiative starts: activation_date, else (new intake only) event_date. */
export function launchDate(i: ScheduleFields): DateOnly | null {
  const a = day(i.activationDate);
  if (!isNewIntake(i)) return a;
  if (a !== null) return i.activationDatePrecision === 'month' ? monthStart(a) : a;
  const e = day(i.eventDate);
  if (e === null) return null;
  return i.eventDatePrecision === 'month' ? monthStart(e) : e;
}

/**
 * When the initiative stops producing revenue. revenue_close_date when set;
 * otherwise the event date (a month-only event closes at the end of its
 * month); otherwise null — open-ended, which is every ongoing initiative
 * without a review date, and every legacy row with no event.
 */
export function revenueCloseDate(i: ScheduleFields): DateOnly | null {
  const close = day(i.revenueCloseDate);
  if (close !== null) return close;
  const e = day(i.eventDate);
  if (e === null) return null;
  return isNewIntake(i) && i.eventDatePrecision === 'month' ? monthEnd(e) : e;
}

export interface HorizonSpan {
  start: DateOnly;
  /** Inclusive; null means open-ended. */
  end: DateOnly | null;
}

/**
 * The span the initiative is active over, or null when it has no dates.
 *
 * A close date earlier than the launch is a data error the form should have
 * refused; it is read as a one-day span on the launch rather than an inverted
 * one, so the initiative is still findable instead of vanishing.
 */
export function horizonSpan(i: ScheduleFields): HorizonSpan | null {
  const start = launchDate(i);
  if (start === null) return null;
  const end = revenueCloseDate(i);
  if (end !== null && end < start) return { start, end: start };
  return { start, end };
}

/**
 * Is the initiative active at any point in [periodStart, periodEnd]
 * (inclusive)? This is the horizon query.
 *
 * LEGACY, unchanged: activation_date <= periodEnd AND (event_date IS NULL OR
 * event_date >= periodStart) — the filter getInitiativesByDateRange always ran.
 * NEW INTAKE: launch <= periodEnd AND (retirement IS NULL OR retirement >=
 * periodStart). Undated initiatives are in no period.
 */
export function overlapsPeriod(i: ScheduleFields, periodStart: Date | string, periodEnd: Date | string): boolean {
  const ps = day(periodStart);
  const pe = day(periodEnd);
  if (ps === null || pe === null) return false;
  if (!isNewIntake(i)) {
    const a = day(i.activationDate);
    if (a === null || a > pe) return false;
    const e = day(i.eventDate);
    return e === null || e >= ps;
  }
  const span = horizonSpan(i);
  if (span === null) return false;
  return span.start <= pe && (span.end === null || span.end >= ps);
}

/**
 * Is the initiative active in the week [weekStart, weekEnd]?
 *
 * LEGACY, unchanged: the weekly planner's own filter, which differs from the
 * horizon query in one place — an evergreen row ignores any event date.
 * NEW INTAKE: the horizon query, but only for day-precision initiatives. A
 * month-only initiative was never given the days that would put it in a
 * particular week, so it stays out of the weekly view entirely.
 */
export function activeInWeek(i: ScheduleFields, weekStart: Date | string, weekEnd: Date | string): boolean {
  if (!isNewIntake(i)) {
    // Literal copy of the planner's comparison, Date objects and all.
    const end = new Date(weekEnd);
    const start = new Date(weekStart);
    const activation = new Date(i.activationDate as Date | string);
    const eventDate = i.eventDate ? new Date(i.eventDate) : null;
    if (i.kind === 'evergreen') return activation <= end;
    if (eventDate) return activation <= end && eventDate >= start;
    return activation <= end;
  }
  return schedulePrecision(i) === 'day' && overlapsPeriod(i, weekStart, weekEnd);
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

/**
 * Does the initiative appear in the calendar cell for `date`?
 *
 * LEGACY, unchanged: on its event day and on its activation day.
 * NEW INTAKE: month-only and undated initiatives never sit on a day (see
 * `inMonthWithoutDay`). An ongoing initiative is a span — every day from
 * launch to its review/close date, open-ended without one. Anything else
 * shows on its activation and event days, as legacy.
 */
export function onCalendarDay(i: ScheduleFields, date: Date | string): boolean {
  const d = day(date);
  if (d === null) return false;
  const a = day(i.activationDate);
  const e = day(i.eventDate);
  if (!isNewIntake(i)) return (e !== null && e === d) || (a !== null && a === d);
  if (schedulePrecision(i) !== 'day') return false;
  if (isOngoing(i.kind)) {
    const span = horizonSpan(i);
    return span !== null && span.start <= d && (span.end === null || d <= span.end);
  }
  return (e !== null && e === d) || (a !== null && a === d);
}

/**
 * A month-only initiative active in the given calendar month (month0 is
 * 0-based, as Date#getMonth). These are listed for the month rather than
 * pinned to a day the user never gave.
 */
export function inMonthWithoutDay(i: ScheduleFields, year: number, month0: number): boolean {
  if (schedulePrecision(i) !== 'month') return false;
  const first = toDateOnly(new Date(year, month0, 1));
  return overlapsPeriod(i, first, monthEnd(first));
}

/* ------------------------------------------------------------------ *
 * Tasks, display, staleness
 * ------------------------------------------------------------------ */

/**
 * The date task lead times count back from: the event, else the activation,
 * else today (an undated initiative still gets a usable task list).
 */
export function taskAnchorDate(
  i: Pick<ScheduleFields, 'eventDate' | 'activationDate'>,
  today: Date = todayDateOnly()
): DateOnly {
  return day(i.eventDate) ?? day(i.activationDate) ?? toDateOnly(today);
}

/** A date as the user gave it: "March 2027" for month precision, else MM/DD/YYYY. */
export function formatScheduleDate(value: DateLike, precision?: DatePrecision | null): string {
  const d = day(value);
  if (d === null) return '';
  if (precision === 'month') {
    return parseDateOnly(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
}

/** Four weeks with no actuals makes an ongoing initiative stale. */
export const ONGOING_STALE_DAYS = 28;

/**
 * Has an ongoing initiative gone four weeks without an actual?
 *
 * `lastActualDate` null means none logged yet. Then `since` (normally the
 * launch date) decides: stale once it is four weeks behind `today`. With no
 * actuals and no `since` there is nothing to measure from but "never", which
 * reads as stale.
 */
export function ongoingStale(lastActualDate: DateLike, today: Date | string, since?: DateLike): boolean {
  const t = day(today);
  if (t === null) return false;
  const ref = day(lastActualDate) ?? day(since);
  if (ref === null) return true;
  return toDateOnly(addDays(ref, ONGOING_STALE_DAYS)) <= t;
}
