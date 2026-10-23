/**
 * Revenue windows for the Initiative Intake (v3).
 *
 * revenue.ts says HOW MUCH a revenue line earns and over WHICH window
 * (opens -> closes). This module says WHEN: it spreads each line's target
 * across its window and buckets the result into Monday-start weeks and
 * calendar months, so the weekly and monthly views can be built from it.
 *
 * RULES
 *
 *   Linear by day, inclusive.  Every calendar day from opens to closes
 *     (both ends included) earns the same share. A one-day window puts the
 *     whole target on that day. We have no curve for how sales arrive inside
 *     a window, and an even spread is the assumption that invents least.
 *
 *   Money is conserved to the cent.  All arithmetic is in integer cents. The
 *     target is rounded to the cent ONCE, then split across buckets by
 *     largest remainder (see `splitCents`), so the buckets of one view sum to
 *     exactly that many cents — no float drift, no lost or invented pennies.
 *     Rounding per DAY and then summing would let a 365-day window drift by
 *     dozens of cents; rounding per bucket independently drifts too.
 *
 *   Inverted windows are unresolved, never swapped.  closes < opens is almost
 *     always a typo in one of the two dates, and we cannot know which. Swapping
 *     would put revenue in a period the user never chose.
 *
 *   Month precision.  An end given as month-only (`YYYY-MM`, or an explicit
 *     `precision: "month"`) is known to the month, not the day. It is read as
 *     the WHOLE month: an opening month starts on its 1st, a closing month ends
 *     on its last day. The monthly view is then honest (all the money lands in
 *     months the user named). The weekly view is NOT: which weeks earn depends
 *     on days we were never told, so weekly is EXCLUDED and reported as such
 *     rather than filled with invented detail.
 *
 *   Mixed precision (one end day-precise, the other month-precise).  The
 *     day-precise end keeps its exact day; the month-precise end expands to
 *     its month boundary as above. The window as a whole is month-precision:
 *     monthly is distributed over the expanded span, weekly is excluded. Why
 *     not trust the exact end for weekly? Because the daily rate itself
 *     depends on the window's length, and that length is a guess — every week,
 *     including those near the exact end, would carry an invented figure.
 *     Inversion is judged on the EXPANDED span, so "opens 2026-05-20, closes
 *     2026-05" (the 20th to the 31st) is valid; it is inverted only when no
 *     day in the named month could make it valid.
 *
 * PURE AND TOTAL. No React, no database, no network. Nothing here throws:
 * every outcome that could fail is a discriminated result. Dates go through
 * plan-dates.ts so a calendar day stays the same calendar day in every
 * timezone.
 */

import { addDays, daysInMonth, parseDateOnly, toDateOnly, type DateOnly } from "../plan-dates";
import type { RevenueLineOutcome, UnresolvedReason } from "./revenue";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export type DatePrecision = "day" | "month";

/**
 * One end of a window. Structurally compatible with revenue.ts's
 * `{ name, date }`; `precision` is optional and, when absent, inferred from
 * the string (`YYYY-MM` is month precision, anything else is a day).
 */
export interface WindowEnd {
  date: string;
  precision?: DatePrecision;
}

export interface RevenueWindow {
  opens: WindowEnd;
  closes: WindowEnd;
}

/** One bucket. `cents` is exact; `amount` is cents / 100 for display. */
export interface RevenueBucket {
  /** Week: the Monday, YYYY-MM-DD. Month: YYYY-MM. */
  key: string;
  cents: number;
  amount: number;
}

export type WeeklyView =
  | { status: "available"; buckets: RevenueBucket[] }
  | { status: "excluded"; reason: "month_precision"; message: string };

export type WindowUnresolvedReason =
  | "invalid_amount"
  | "invalid_date"
  | "window_inverted"
  | "window_too_long"
  | "amount_too_large";

export type WindowDistribution =
  | {
      status: "distributed";
      /** The target rounded to the cent; every view sums to exactly this. */
      totalCents: number;
      precision: DatePrecision;
      /** The span actually used, after month expansion. Inclusive. */
      start: DateOnly;
      end: DateOnly;
      days: number;
      weekly: WeeklyView;
      monthly: RevenueBucket[];
    }
  | { status: "unresolved"; reason: WindowUnresolvedReason; message: string };

/**
 * Twenty years of days. A revenue window is weeks or months; anything this
 * long is a mistyped year, and walking it day by day would be wasted work.
 */
export const MAX_WINDOW_DAYS = 366 * 20;

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const MONTH_ONLY = /^(\d{4})-(\d{2})$/;
const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

const pad2 = (n: number): string => String(n).padStart(2, "0");

type ResolvedEnd = { day: DateOnly; precision: DatePrecision } | null;

/**
 * Read one end to a concrete day. `side` decides where a month-precision end
 * lands: the 1st for an opening, the last day for a closing.
 *
 * `YYYY-MM` is matched before anything else because parseDateOnly would hand
 * it to `new Date("2026-05")`, which is UTC midnight and can read as April 30
 * west of UTC — exactly the drift plan-dates.ts exists to prevent.
 */
function resolveEnd(end: WindowEnd, side: "opens" | "closes"): ResolvedEnd {
  if (!end || typeof end.date !== "string") return null;
  const raw = end.date.trim();

  let year: number;
  let month: number;
  let precision: DatePrecision;
  let exactDay: DateOnly | null = null;

  const monthOnly = MONTH_ONLY.exec(raw);
  if (monthOnly) {
    year = Number(monthOnly[1]);
    month = Number(monthOnly[2]);
    precision = "month";
  } else {
    const d = parseDateOnly(raw);
    if (isNaN(d.getTime())) return null;
    // A YYYY-MM-DD prefix must be a real day: parseDateOnly happily rolls
    // "2026-02-31" into March, which would silently move revenue.
    const m = DAY_PREFIX.exec(raw);
    if (m && (d.getFullYear() !== Number(m[1]) || d.getMonth() + 1 !== Number(m[2]) || d.getDate() !== Number(m[3]))) {
      return null;
    }
    year = d.getFullYear();
    month = d.getMonth() + 1;
    precision = end.precision === "month" ? "month" : "day";
    exactDay = toDateOnly(d);
  }
  if (month < 1 || month > 12) return null;

  if (precision === "day") return { day: exactDay as DateOnly, precision };
  const dom = side === "opens" ? 1 : daysInMonth(year, month);
  return { day: `${year}-${pad2(month)}-${pad2(dom)}`, precision };
}

/** The Monday on or before a day. Weekly results key on Monday week_start_date. */
export function mondayOf(day: Date | string): DateOnly {
  const d = parseDateOnly(day);
  // getDay(): 0 = Sunday. (getDay() + 6) % 7 is days since Monday.
  return toDateOnly(addDays(d, -((d.getDay() + 6) % 7)));
}

export const monthKeyOf = (day: DateOnly): string => day.slice(0, 7);

/* ------------------------------------------------------------------ *
 * Rounding
 * ------------------------------------------------------------------ */

/**
 * Split `totalCents` across buckets in proportion to `weights` (day counts),
 * by largest remainder: every bucket gets the floor of its exact share, then
 * the cents left over go one each to the buckets with the largest fractional
 * parts. Ties go to the earlier bucket so the result is deterministic.
 *
 * All integer arithmetic: share = totalCents * w / sum is computed as an
 * integer quotient and remainder, so there is no float error to round away.
 * The caller guarantees totalCents * sum is a safe integer.
 */
export function splitCents(totalCents: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const floors: number[] = [];
  const rems: number[] = [];
  let given = 0;
  for (const w of weights) {
    const p = totalCents * w;
    const r = p % sum;
    const f = (p - r) / sum;
    floors.push(f);
    rems.push(r);
    given += f;
  }
  let left = totalCents - given; // always 0 <= left < weights.length
  const order = weights.map((_, i) => i).sort((a, b) => rems[b] - rems[a] || a - b);
  for (const i of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

const bucket = (key: string, cents: number): RevenueBucket => ({ key, cents, amount: cents / 100 });

/** Group the window's days by key, preserving chronological order. */
function groupDays(days: readonly DateOnly[], keyOf: (d: DateOnly) => string): { keys: string[]; counts: number[] } {
  const keys: string[] = [];
  const counts: number[] = [];
  for (const d of days) {
    const k = keyOf(d);
    if (keys.length > 0 && keys[keys.length - 1] === k) counts[counts.length - 1] += 1;
    else {
      keys.push(k);
      counts.push(1);
    }
  }
  return { keys, counts };
}

/* ------------------------------------------------------------------ *
 * One window
 * ------------------------------------------------------------------ */

/**
 * Spread `amount` linearly by day across `window` and bucket it by week and
 * by month. See the module comment for the rules.
 */
export function distributeWindow(amount: number, window: RevenueWindow): WindowDistribution {
  const fail = (reason: WindowUnresolvedReason, message: string): WindowDistribution => ({
    status: "unresolved",
    reason,
    message,
  });

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return fail("invalid_amount", `${String(amount)} is not a usable revenue amount.`);
  }
  const opens = resolveEnd(window?.opens, "opens");
  if (!opens) return fail("invalid_date", `"${String(window?.opens?.date)}" is not a usable opening date.`);
  const closes = resolveEnd(window?.closes, "closes");
  if (!closes) return fail("invalid_date", `"${String(window?.closes?.date)}" is not a usable closing date.`);

  // Date-only strings compare correctly as strings.
  if (closes.day < opens.day) {
    return fail(
      "window_inverted",
      `The window closes (${window.closes.date}) before it opens (${window.opens.date}).`
    );
  }

  const days: DateOnly[] = [];
  for (let d = opens.day; d <= closes.day; d = toDateOnly(addDays(d, 1))) {
    days.push(d);
    if (days.length > MAX_WINDOW_DAYS) {
      return fail("window_too_long", `The window is longer than ${MAX_WINDOW_DAYS} days.`);
    }
  }

  const totalCents = Math.round(amount * 100);
  // splitCents multiplies cents by day counts; past 2^53 the integer
  // arithmetic that makes the sum exact is no longer exact.
  if (!Number.isSafeInteger(totalCents * days.length)) {
    return fail("amount_too_large", `${amount} is too large to distribute to the cent.`);
  }

  const months = groupDays(days, monthKeyOf);
  const monthCents = splitCents(totalCents, months.counts);
  const monthly = months.keys.map((k, i) => bucket(k, monthCents[i]));

  const precision: DatePrecision =
    opens.precision === "month" || closes.precision === "month" ? "month" : "day";

  let weekly: WeeklyView;
  if (precision === "month") {
    weekly = {
      status: "excluded",
      reason: "month_precision",
      message: "At least one end of the window is known only to the month, so its weeks cannot be placed.",
    };
  } else {
    const weeks = groupDays(days, mondayOf);
    const weekCents = splitCents(totalCents, weeks.counts);
    weekly = { status: "available", buckets: weeks.keys.map((k, i) => bucket(k, weekCents[i])) };
  }

  return {
    status: "distributed",
    totalCents,
    precision,
    start: opens.day,
    end: closes.day,
    days: days.length,
    weekly,
    monthly,
  };
}

/* ------------------------------------------------------------------ *
 * Every line
 * ------------------------------------------------------------------ */

export interface SkippedLine {
  id: string;
  /** From revenue.ts when the line never resolved, or from distributeWindow. */
  reason: UnresolvedReason | WindowUnresolvedReason;
  message: string;
}

export interface LinesDistribution {
  /** Summed across lines, chronological. Day-precision lines only. */
  weekly: RevenueBucket[];
  /** Summed across lines, chronological. Every distributed line. */
  monthly: RevenueBucket[];
  /** Per-line results for lines that distributed. */
  lines: { id: string; distribution: Extract<WindowDistribution, { status: "distributed" }> }[];
  /** Lines with no distribution at all: listed, never silently dropped. */
  skipped: SkippedLine[];
  /** Distributed lines left out of `weekly` because of month precision. */
  excludedFromWeekly: string[];
  /** Exact totals of each view, in cents. They differ only by excluded lines. */
  weeklyCents: number;
  monthlyCents: number;
}

function addInto(acc: Map<string, number>, buckets: readonly RevenueBucket[]): void {
  for (const b of buckets) acc.set(b.key, (acc.get(b.key) ?? 0) + b.cents);
}

/** Keys are date strings, so lexical order is chronological. */
const toBuckets = (acc: Map<string, number>): RevenueBucket[] =>
  Array.from(acc.keys())
    .sort()
    .map((k) => bucket(k, acc.get(k) as number));

/**
 * Distribute every resolved line from `resolveRevenueLines` and sum the
 * buckets across lines. Summing integer cents keeps the across-line totals
 * exact too: each view's total is the sum of its lines' rounded targets.
 *
 * Unresolved lines, and resolved lines whose window cannot be distributed,
 * are listed in `skipped` so the caller can say the figures are a lower
 * bound — the same stance revenue.ts takes on its total.
 */
export function distributeRevenueLines(lines: readonly RevenueLineOutcome[]): LinesDistribution {
  const weeklyAcc = new Map<string, number>();
  const monthlyAcc = new Map<string, number>();
  const out: LinesDistribution["lines"] = [];
  const skipped: SkippedLine[] = [];
  const excludedFromWeekly: string[] = [];
  let weeklyCents = 0;
  let monthlyCents = 0;

  for (const line of lines) {
    if (line.status === "unresolved") {
      skipped.push({ id: line.id, reason: line.reason, message: line.message });
      continue;
    }
    const dist = distributeWindow(line.target, line.window as RevenueWindow);
    if (dist.status === "unresolved") {
      skipped.push({ id: line.id, reason: dist.reason, message: dist.message });
      continue;
    }
    out.push({ id: line.id, distribution: dist });
    addInto(monthlyAcc, dist.monthly);
    monthlyCents += dist.totalCents;
    if (dist.weekly.status === "available") {
      addInto(weeklyAcc, dist.weekly.buckets);
      weeklyCents += dist.totalCents;
    } else {
      excludedFromWeekly.push(line.id);
    }
  }

  return {
    weekly: toBuckets(weeklyAcc),
    monthly: toBuckets(monthlyAcc),
    lines: out,
    skipped,
    excludedFromWeekly,
    weeklyCents,
    monthlyCents,
  };
}
