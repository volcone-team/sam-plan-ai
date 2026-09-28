/**
 * Date-only arithmetic for plan scheduling.
 *
 * WHY THIS EXISTS
 * Postgres `DATE` columns (`tasks.due_date`, `initiatives.activation_date`,
 * `initiatives.event_date`) serialise as `YYYY-MM-DD`. Two habits corrupted
 * them across this codebase:
 *
 *   1. `new Date("2026-08-31")` parses as UTC midnight. For any user behind
 *      UTC — the app default is America/New_York — that is Aug 30 locally, so
 *      every due date read back a day early and every window comparison was
 *      off by one.
 *   2. `date.toISOString().split("T")[0]` converts a LOCAL date to a UTC
 *      calendar day, shifting it forward for users ahead of UTC.
 *
 * Every helper here works on the local calendar day and never touches
 * `toISOString()`. A calendar day written is the same calendar day read, in
 * every timezone.
 */

/** A calendar day with no time component, `YYYY-MM-DD`. */
export type DateOnly = string;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Parse a date-only value to LOCAL midnight.
 *
 * Deliberately not `new Date(s)`: that treats a bare `YYYY-MM-DD` as UTC.
 * Non-date-only strings fall through to normal parsing so callers can pass a
 * full timestamp, and a `Date` is returned as a local-midnight copy.
 */
export function parseDateOnly(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const m = DATE_ONLY.exec(value);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return parsed;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** Format as `YYYY-MM-DD` from the LOCAL calendar day. Never uses toISOString. */
export function toDateOnly(value: Date | string): DateOnly {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    return value.slice(0, 10);
  }
  const d = value instanceof Date ? value : parseDateOnly(value);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Shift by whole days. JS Date normalises month/year overflow both ways. */
export function addDays(value: Date | string, days: number): Date {
  const d = parseDateOnly(value);
  if (isNaN(d.getTime())) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function subDays(value: Date | string, days: number): Date {
  return addDays(value, -days);
}

/** Same local calendar day. */
export function isSameDateOnly(a: Date | string, b: Date | string): boolean {
  const x = toDateOnly(a);
  return !!x && x === toDateOnly(b);
}

/** Inclusive at both ends, compared as calendar days (string compare is safe). */
export function isWithinDateOnly(
  value: Date | string,
  start: Date | string,
  end: Date | string
): boolean {
  const v = toDateOnly(value);
  const s = toDateOnly(start);
  const e = toDateOnly(end);
  if (!v || !s || !e) return false;
  return v >= s && v <= e;
}

/** Days a task is due BEFORE its anchor when the model gives us nothing usable. */
export const DEFAULT_LEAD_DAYS = 7;

/**
 * Normalise a lead time to a non-negative whole number of days.
 *
 * CONVENTION: `daysBeforeEvent` is a COUNT OF DAYS BEFORE the event, so it is
 * non-negative and is always SUBTRACTED from the anchor. We take the magnitude
 * rather than trusting the sign, because the generation prompt and
 * `initiative-type.types.ts` historically documented opposite conventions and
 * the model returns either. Garbage falls back to DEFAULT_LEAD_DAYS.
 */
export function resolveLeadDays(raw: unknown, fallback = DEFAULT_LEAD_DAYS): number {
  // null/undefined/'' must fall back, NOT coerce to 0. `Number(null) === 0` is
  // finite, so a missing lead time would otherwise land the task ON the event
  // date instead of a sensible number of days before it.
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.abs(Math.trunc(n));
}

/**
 * A task's due date: the anchor minus its lead time.
 *
 * Guarantees, for every input: the result is never after the anchor. This is
 * the fix for tasks being scheduled AFTER the event they prepare for — the old
 * code ADDED the lead time to a hardcoded mid-month date.
 */
export function computeTaskDueDate(anchor: Date | string, rawLead: unknown): Date {
  return subDays(anchor, resolveLeadDays(rawLead));
}

/** Days in a month, 1-indexed month. */
export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Clamp a day-of-month into a real day for that month (e.g. 31 in Feb). */
export function clampDayOfMonth(year: number, month1: number, day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(Math.max(1, Math.trunc(day)), daysInMonth(year, month1));
}

/**
 * Where month 1 of a generated plan sits.
 *
 * A plan must never be generated into the past. Selecting the CURRENT year and
 * a 12-month period in September means Sept this year through Aug next year —
 * not January through December, which is eight months already gone.
 *
 * The rule keys off the YEAR, not off whether a target year was supplied. The
 * old code read `targetYear ? 1 : now.getMonth() + 1`, so picking the current
 * year from the year switcher forced a January start and produced initiatives
 * dated months in the past.
 *
 *   selected year === this year -> start at the current month (forward only)
 *   selected year  >  this year -> start in January (the whole year is ahead)
 *   selected year  <  this year -> start in January (historical, full year)
 */
export function resolvePlanStart(
  targetYear: number | undefined,
  now: Date = new Date()
): { startYear: number; startMonth: number } {
  const startYear = targetYear ?? now.getFullYear();
  const startMonth = startYear === now.getFullYear() ? now.getMonth() + 1 : 1;
  return { startYear, startMonth };
}

/**
 * The calendar month/year a plan month lands in.
 *
 * `planMonth` is 1-based and relative to the plan's start, so plan month 1 is
 * always the start month. Rolls into the following year as needed, which is
 * what makes a 12-month plan starting in September end the next August.
 */
export function planMonthToCalendar(
  startYear: number,
  startMonth: number,
  planMonth: number
): { year: number; month: number } {
  const offset = Math.max(1, Math.trunc(planMonth || 1)) - 1;
  const zeroBased = startMonth - 1 + offset;
  return { year: startYear + Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** Today with the time stripped, as a local calendar day. */
export function todayDateOnly(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Never earlier than `floor`.
 *
 * A generated plan must not contain dates that have already happened. Getting
 * the start MONTH right is not enough: a plan generated on 27 September whose
 * first initiative activates on the 1st and has its event on the 15th is still
 * describing the past. Every generated activation date, event date and task due
 * date is floored at today.
 */
export function clampNotBefore(value: Date | string, floor: Date | string): Date {
  const v = parseDateOnly(value);
  const f = parseDateOnly(floor);
  if (isNaN(v.getTime())) return f;
  if (isNaN(f.getTime())) return v;
  return v.getTime() < f.getTime() ? f : v;
}

/**
 * How much runway an initiative needs, DERIVED from its own tasks.
 *
 * The AI already tells us how far ahead each task must happen
 * (`daysBeforeEvent`). The largest of those IS the preparation window: if the
 * earliest task must land 21 days before the event, then an event less than 21
 * days out means that task was due before the plan existed.
 *
 * This replaces a hardcoded minimum. A webinar whose longest task lead is 21
 * days gets 21 days; a LinkedIn push whose longest lead is 3 days gets 3. The
 * runway is whatever the plan itself says the work requires, so it stays
 * correct as the generated task lists change.
 *
 * An initiative with no tasks needs no runway - there is nothing to prepare.
 */
export function requiredRunwayDays(
  tasks: ReadonlyArray<{ daysBeforeEvent?: unknown }> | undefined | null
): number {
  if (!tasks || tasks.length === 0) return 0;
  let max = 0;
  for (const t of tasks) {
    // resolveLeadDays applies the same magnitude/fallback rules used when the
    // task's own due date is computed, so the runway and the due dates agree.
    const lead = resolveLeadDays(t?.daysBeforeEvent);
    if (lead > max) max = lead;
  }
  return max;
}

/**
 * The earliest date an initiative's event may fall on: today plus the runway
 * its own tasks require.
 */
export function earliestEventDate(runwayDays: number, now: Date = new Date()): Date {
  return addDays(todayDateOnly(now), Math.max(0, runwayDays));
}

/** The later of two calendar days. */
export function laterDateOnly(a: Date | string, b: Date | string): Date {
  return clampNotBefore(a, b);
}
