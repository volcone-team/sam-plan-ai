/**
 * Which calendar years a plan horizon covers, and how the revenue goal is
 * split across them.
 *
 * `annual_plans` is one row per CALENDAR year, while the intake plans over a
 * horizon that starts on any month (plan_start_month + horizon_months). A plan
 * starting November 2026 for 12 months is two months of 2026 and ten of 2027,
 * so each of those years needs its own row and its own share of the goal.
 * Without that, a year the horizon covers has no row at all and the dashboard
 * reads "No target set".
 *
 * Pure: no database, no clock. Used by intake build and POST /api/initiatives.
 * scripts/repair-plan-years.mjs carries a copy, since it runs as plain Node.
 */

export interface HorizonYear {
  year: number;
  /** How many of the horizon's months fall in this calendar year (1–12). */
  months: number;
}

/**
 * The calendar years from `startMonth` through start + `months` − 1, with the
 * number of horizon months in each.
 *
 * `startMonth` is a date string; only its year and month are read
 * ("2026-11-01" and "2026-11" are the same). Returns [] for an unreadable
 * start or a horizon under one month.
 */
export function horizonYears(startMonth: string | null | undefined, months: number): HorizonYear[] {
  const match = /^(\d{4})-(\d{2})/.exec(String(startMonth ?? ''));
  const span = Math.floor(Number(months));
  if (!match || !Number.isFinite(span) || span < 1) return [];

  const startYear = Number(match[1]);
  const startIndex = Number(match[2]) - 1; // 0-based month
  if (startIndex < 0 || startIndex > 11) return [];

  const out: HorizonYear[] = [];
  let remaining = span;
  let year = startYear;
  let monthIndex = startIndex;
  while (remaining > 0) {
    const inYear = Math.min(12 - monthIndex, remaining);
    out.push({ year, months: inYear });
    remaining -= inYear;
    year += 1;
    monthIndex = 0;
  }
  return out;
}

/**
 * Split `total` across the horizon years in proportion to their months.
 *
 * Whole dollars. Every year but the last is rounded on its own; the last takes
 * whatever is left, so the parts always sum to the (rounded) total. A total of
 * zero, negative or not a number gives zero for every year.
 */
export function prorate(total: number, years: readonly HorizonYear[]): Map<number, number> {
  const out = new Map<number, number>();
  if (years.length === 0) return out;

  const whole = Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
  const totalMonths = years.reduce((sum, y) => sum + y.months, 0);

  let allocated = 0;
  years.forEach((y, index) => {
    if (index === years.length - 1) {
      out.set(y.year, whole - allocated);
      return;
    }
    const share = totalMonths > 0 ? Math.round((whole * y.months) / totalMonths) : 0;
    out.set(y.year, share);
    allocated += share;
  });
  return out;
}

export interface YearTargets {
  year: number;
  months: number;
  baseline: number;
  stretch: number;
}

/** Baseline and stretch, each prorated across the horizon years. */
export function prorateTargets(
  targets: { baseline: number; stretch: number },
  years: readonly HorizonYear[]
): YearTargets[] {
  const baseline = prorate(targets.baseline, years);
  const stretch = prorate(targets.stretch, years);
  return years.map((y) => ({
    year: y.year,
    months: y.months,
    baseline: baseline.get(y.year) ?? 0,
    stretch: stretch.get(y.year) ?? 0,
  }));
}

/**
 * The calendar year an initiative launches in: its activation date's year,
 * else its event date's, else null (undated).
 *
 * The year is read straight off the "YYYY-MM-DD" prefix so no timezone can
 * move a 1 January date into the previous year.
 */
export function launchYear(
  activationDate: string | Date | null | undefined,
  eventDate: string | Date | null | undefined
): number | null {
  for (const value of [activationDate, eventDate]) {
    const year = yearOf(value);
    if (year !== null) return year;
  }
  return null;
}

function yearOf(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    return Number.isFinite(y) ? y : null;
  }
  const match = /^(\d{4})-\d{2}/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * Which plan year a hand-added initiative belongs to.
 *
 * Its launch year when it has a date; otherwise the year of the plan the
 * caller passed (the page's selected year), which is the only signal left for
 * an undated initiative.
 */
export function planYearForInitiative(
  dates: { activationDate?: string | null; eventDate?: string | null },
  passedPlanYear: number
): number {
  return launchYear(dates.activationDate ?? null, dates.eventDate ?? null) ?? passedPlanYear;
}
