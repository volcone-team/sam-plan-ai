/**
 * Revenue and targets per month, quarter and week, computed from the
 * initiatives and the annual plan.
 *
 * The Monthly, Quarterly and Weekly planners used to read `projections`,
 * `monthly_plans`, `quarterly_plans` and `weekly_plans`. Nothing the current
 * intake runs writes those tables, so every month showed $0 while the
 * initiatives listed beneath it carried real figures. These figures come from
 * the same rows the user sees, so a month's total is the sum of the
 * initiatives shown under it.
 *
 * RULES (owner decision, Oct 2026)
 *   - A one-time initiative's whole Good/Better/Best lands in the month of
 *     its EVENT date (else its launch month).
 *   - A recurring initiative is split evenly across its run dates, and an
 *     ongoing one across its active months (revenue-spread.ts), so a weekly
 *     webinar earns every month instead of once.
 *   - The month target is the year's plan goal (annual_plans.baseline_revenue)
 *     spread evenly over the months of that year the plan horizon covers. With
 *     no horizon on record, all twelve months share it.
 *   - The week target is the sum of the daily share of each month the week
 *     touches, so a week split across two months takes part of each and the
 *     weeks of a month add back up to the month.
 *
 * Pure: no React, no database, no clock.
 */
import { daysInMonth, toDateOnly, type DateOnly } from '@/lib/plan-dates';
import { launchDate, type ScheduleFields } from '@/lib/initiatives/schedule';
import { horizonYears } from '@/lib/intake/plan-years';
import { monthShares, type Scenarios, type SpreadRow } from '@/lib/planning/revenue-spread';

export type { Scenarios };

export interface RevenueRow extends SpreadRow {
  id?: string;
}

/** One initiative's share of a period. */
export interface BucketEntry<T> extends Scenarios {
  initiative: T;
  /** Recurring runs in the period (0 for one-time and ongoing work). */
  runs: number;
  /** The dates that put revenue in this period (run dates, or the event date); empty for ongoing work. */
  dates: DateOnly[];
}

export interface PeriodBucket<T> extends Scenarios {
  /** Each initiative with revenue in this period, once, with its share. */
  entries: BucketEntry<T>[];
  /** The same initiatives, for counting and listing. */
  initiatives: T[];
}

export interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

const YEAR_MONTH = /^(\d{4})-(\d{2})/;

/**
 * The month a ONE-TIME initiative's revenue is counted in: its event date's
 * month, else its launch month, else null (undated, counted nowhere).
 * Recurring and ongoing work spreads over several months; see monthShares.
 */
export function revenueMonth(i: ScheduleFields): YearMonth | null {
  const event = i.eventDate ? toDateOnly(i.eventDate) : '';
  const source = event || launchDate(i) || '';
  const match = YEAR_MONTH.exec(source);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

function amount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyBucket<T>(): PeriodBucket<T> {
  return { good: 0, better: 0, best: 0, entries: [], initiatives: [] };
}

/**
 * Twelve buckets (index 0 = January) for `year`.
 *
 * Revenue is placed by monthShares: one-time work in its event month,
 * recurring work across its run dates, ongoing work across its active months.
 * `planEnd` (last day of the plan horizon) bounds recurring and ongoing
 * spreads; null means twelve months from the first run.
 */
export function monthBuckets<T extends RevenueRow>(
  list: readonly T[],
  year: number,
  planEnd: DateOnly | null = null
): PeriodBucket<T>[] {
  const months = Array.from({ length: 12 }, () => emptyBucket<T>());
  for (const i of list) {
    for (const s of monthShares(i, planEnd)) {
      if (s.year !== year) continue;
      const bucket = months[s.month - 1];
      bucket.good += s.good;
      bucket.better += s.better;
      bucket.best += s.best;
      bucket.entries.push({ initiative: i, good: s.good, better: s.better, best: s.best, runs: s.runs, dates: s.dates });
      bucket.initiatives.push(i);
    }
  }
  return months;
}

/** Four buckets (index 0 = Q1), each the sum of its three months. */
export function quarterBuckets<T>(months: readonly PeriodBucket<T>[]): PeriodBucket<T>[] {
  return [0, 1, 2, 3].map((q) => sumBuckets(months.slice(q * 3, q * 3 + 3)));
}

/**
 * One bucket holding the sum of `buckets`. An initiative spread over several
 * of them appears ONCE, carrying its combined share.
 */
export function sumBuckets<T>(buckets: readonly Pick<PeriodBucket<T>, 'good' | 'better' | 'best' | 'entries'>[]): PeriodBucket<T> {
  const out = emptyBucket<T>();
  const byInitiative = new Map<T, BucketEntry<T>>();
  for (const b of buckets) {
    out.good += b.good;
    out.better += b.better;
    out.best += b.best;
    for (const e of b.entries) {
      const seen = byInitiative.get(e.initiative);
      if (seen) {
        seen.good += e.good;
        seen.better += e.better;
        seen.best += e.best;
        seen.runs += e.runs;
        seen.dates = [...seen.dates, ...e.dates];
      } else {
        byInitiative.set(e.initiative, { ...e, dates: [...e.dates] });
      }
    }
  }
  out.entries = [...byInitiative.values()];
  out.initiatives = out.entries.map((e) => e.initiative);
  return out;
}

/**
 * The months (1–12) of `year` that the plan horizon covers.
 *
 * With no readable horizon every month is covered, which is how a plan with
 * no recorded start behaved before.
 */
export function coveredMonths(
  planStartMonth: string | null | undefined,
  horizonMonths: number | null | undefined,
  year: number
): number[] {
  const all = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = horizonYears(planStartMonth, Number(horizonMonths));
  if (years.length === 0) return all;

  const entry = years.find((y) => y.year === year);
  if (!entry) return [];
  const first = years[0];
  const startMonth = Number(YEAR_MONTH.exec(String(planStartMonth))![2]);
  // The first horizon year starts at the plan's start month; later ones in January.
  const from = entry.year === first.year ? startMonth : 1;
  return all.filter((m) => m >= from && m < from + entry.months);
}

/**
 * Twelve month targets (index 0 = January) splitting `yearTarget` evenly over
 * `covered`. Whole dollars; the last covered month takes the rounding
 * remainder so the months always add back up to the year.
 */
export function monthlyTargets(yearTarget: number, covered: readonly number[]): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  const total = Number.isFinite(yearTarget) && yearTarget > 0 ? Math.round(yearTarget) : 0;
  const months = [...new Set(covered)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (total === 0 || months.length === 0) return out;

  const share = Math.round(total / months.length);
  let allocated = 0;
  months.forEach((m, index) => {
    const value = index === months.length - 1 ? total - allocated : share;
    out[m - 1] = value;
    allocated += value;
  });
  return out;
}

/** Sum of the four quarter targets from twelve month targets. */
export function quarterTargets(months: readonly number[]): number[] {
  return [0, 1, 2, 3].map((q) => months.slice(q * 3, q * 3 + 3).reduce((s, v) => s + v, 0));
}

/**
 * The target for the seven days starting `weekStart`: each day takes
 * 1/daysInMonth of its month's target. `targetFor` supplies a month's target
 * and may be asked about two different years when the week crosses New Year.
 */
export function weekTarget(
  weekStart: Date,
  targetFor: (year: number, month: number) => number
): number {
  let sum = 0;
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    sum += amount(targetFor(year, month)) / daysInMonth(year, month);
  }
  return Math.round(sum);
}
