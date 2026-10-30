/**
 * Where an initiative's revenue falls in time.
 *
 * `initiatives.revenue_*` holds the WHOLE figure for the plan: for a recurring
 * initiative that is every run added together (the intake multiplies one run
 * by the number of runs). Putting all of it in one month made a weekly webinar
 * look like a single $75,000 event. This module spreads it:
 *
 *   - RECURRING with a frequency: split evenly across its occurrences, from
 *     the first event to the LAST OCCURRENCE (else the plan end). The revenue
 *     close date does not end the series; it is each occurrence's cart close.
 *     A weekly run lands ~4 times a month, a quarterly one once a quarter.
 *   - ONGOING / evergreen: split evenly across the months it is active, launch
 *     month to the end of the window.
 *   - Everything else: all of it in the event month (else the launch month).
 *
 * The parts always add back up to the stored figure, so year totals still
 * match Year at a Glance.
 *
 * Pure: no React, no database, no clock.
 */
import { instanceDates, type RecurrenceFrequency } from '@/lib/initiatives/recurring';
import { RECURRENCE_FREQUENCIES } from '@/lib/intake-v3/library-config';
import { isOngoing, launchDate, type ScheduleFields } from '@/lib/initiatives/schedule';
import { toDateOnly, type DateOnly } from '@/lib/plan-dates';
import {
  lastOccurrenceOf,
  occurrenceOverridesOf,
  perOccurrenceOf,
  type OccurrenceFields,
} from '@/lib/initiatives/occurrences';

export interface Scenarios {
  good: number;
  better: number;
  best: number;
}

export interface SpreadRow extends ScheduleFields, OccurrenceFields {
  revenueScenarios?: Partial<Scenarios> | null;
  repeatFrequency?: string | null;
}

/** One month's share of an initiative's revenue. */
export interface MonthShare extends Scenarios {
  year: number;
  /** 1–12 */
  month: number;
  /** Runs falling in this month (recurring only; 0 otherwise). */
  runs: number;
  /** The dates that put revenue here: each run, or the event date. Empty for ongoing work. */
  dates: DateOnly[];
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;

function day(v: Date | string | null | undefined): DateOnly | null {
  if (v === null || v === undefined || v === '') return null;
  const s = toDateOnly(v);
  return YMD.test(s) ? s.slice(0, 10) : null;
}

function amount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function scenariosOf(i: SpreadRow): Scenarios {
  return {
    good: amount(i.revenueScenarios?.good),
    better: amount(i.revenueScenarios?.better),
    best: amount(i.revenueScenarios?.best),
  };
}

/** A known recurrence frequency, or null. */
export function recurrenceOf(i: Pick<SpreadRow, 'kind' | 'repeatFrequency'>): RecurrenceFrequency | null {
  if (i.kind !== 'recurring') return null;
  const f = i.repeatFrequency;
  return typeof f === 'string' && (RECURRENCE_FREQUENCIES as readonly string[]).includes(f)
    ? (f as RecurrenceFrequency)
    : null;
}

/** The last day of a horizon: `startMonth` (YYYY-MM...) + `months`, minus one day. */
export function horizonEnd(startMonth: string | null | undefined, months: number | null | undefined): DateOnly | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(startMonth ?? ''));
  const span = Math.floor(Number(months));
  if (!m || !Number.isFinite(span) || span < 1) return null;
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + span, 0));
  return end.toISOString().slice(0, 10);
}

/** `d` plus whole months, minus one day: the default window when no plan end is known. */
function twelveMonthsFrom(d: DateOnly): DateOnly {
  const end = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1 + 12, Number(d.slice(8, 10)) - 1));
  return end.toISOString().slice(0, 10);
}

/** The end of the window revenue is spread over. */
function windowEnd(i: SpreadRow, start: DateOnly, planEnd: DateOnly | null): DateOnly {
  const close = day(i.revenueCloseDate);
  const end = planEnd ?? twelveMonthsFrom(start);
  return close !== null && close < end ? close : end;
}

/**
 * Where a recurring series ends: its LAST OCCURRENCE when one is recorded,
 * else the plan end (else twelve months on).
 *
 * NOT the revenue close date. That is the cart / round close for an
 * occurrence (client, Oct 2026): letting it end the series gave a monthly
 * webinar whose cart closed three days later exactly one occurrence.
 */
function seriesEnd(i: SpreadRow, first: DateOnly, planEnd: DateOnly | null): DateOnly {
  return lastOccurrenceOf(i) ?? planEnd ?? twelveMonthsFrom(first);
}

/**
 * Every run date of a recurring initiative from its first event up to the
 * series end. A first run already past the end still returns that one date,
 * so its revenue is never dropped.
 */
export function runDates(i: SpreadRow, planEnd: DateOnly | null): DateOnly[] {
  return runSchedule(i, planEnd).map((r) => r.date);
}

/** One occurrence: the date it falls on and the date the schedule gave it. */
export interface RunSlot {
  date: DateOnly;
  scheduled: DateOnly;
}

/**
 * Every occurrence with any one-off moves applied (attrs.occurrence_overrides),
 * in date order. The schedule itself is still worked out from the first
 * occurrence and the frequency, so moving one occurrence never shifts the
 * others, and the number of occurrences stays the same.
 */
export function runSchedule(i: SpreadRow, planEnd: DateOnly | null): RunSlot[] {
  const moves = occurrenceOverridesOf(i);
  return scheduledRunDates(i, planEnd)
    .map((scheduled) => ({ scheduled, date: moves[scheduled] ?? scheduled }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.scheduled < b.scheduled ? -1 : 1));
}

/** The calculated run dates, before any one-off moves. */
export function scheduledRunDates(i: SpreadRow, planEnd: DateOnly | null): DateOnly[] {
  const frequency = recurrenceOf(i);
  const first = day(i.eventDate) ?? launchDate(i);
  if (!frequency || !first) return [];
  const end = seriesEnd(i, first, planEnd);
  if (end < first) return [first];
  const out: DateOnly[] = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (const d of instanceDates({ frequency, firstEventDate: first }, y)) {
      if (d >= first && d <= end) out.push(d);
    }
  }
  return out.length > 0 ? out : [first];
}

/** Months (as YYYY-MM) from `from` through `to` inclusive. */
function monthsBetween(from: DateOnly, to: DateOnly): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * The months an initiative's revenue falls in, with each month's share.
 * `planEnd` is the last day of the plan horizon, or null when unknown.
 */
export function monthShares(i: SpreadRow, planEnd: DateOnly | null): MonthShare[] {
  const total = scenariosOf(i);

  // Recurring: an equal share per run.
  const runs = runDates(i, planEnd);
  if (runs.length > 0) {
    const byMonth = new Map<string, DateOnly[]>();
    for (const d of runs) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d]);
    return [...byMonth.entries()].map(([key, dates]) => share(key, dates.length / runs.length, total, dates.length, dates));
  }

  // Ongoing: an equal share per active month.
  const launch = launchDate(i);
  if (isOngoing(i.kind) && launch) {
    const months = monthsBetween(launch, windowEnd(i, launch, planEnd));
    return months.map((key) => share(key, 1 / months.length, total, 0, []));
  }

  // One-time and anything else: the event month, else the launch month.
  const at = day(i.eventDate) ?? launch;
  if (!at) return [];
  return [share(at.slice(0, 7), 1, total, 0, [at])];
}

function share(key: string, fraction: number, total: Scenarios, runs: number, dates: DateOnly[]): MonthShare {
  return {
    dates,
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    good: total.good * fraction,
    better: total.better * fraction,
    best: total.best * fraction,
    runs,
  };
}

/**
 * Per-occurrence figures for a recurring initiative, or null when it has no
 * occurrences.
 *
 * When the per-occurrence Good was recorded (migration 061, or attrs before
 * it) that is the figure, and Better / Best keep the stored total's ratios.
 * Otherwise (older rows) the stored total divided by the occurrences.
 */
export function perRun(i: SpreadRow, planEnd: DateOnly | null): (Scenarios & { runs: number }) | null {
  const runs = runDates(i, planEnd).length;
  if (runs === 0) return null;
  const t = scenariosOf(i);
  const recorded = perOccurrenceOf(i);
  if (recorded !== null && t.good > 0) {
    return {
      good: recorded,
      better: (recorded * t.better) / t.good,
      best: (recorded * t.best) / t.good,
      runs,
    };
  }
  return { good: t.good / runs, better: t.better / runs, best: t.best / runs, runs };
}
