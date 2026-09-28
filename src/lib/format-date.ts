/**
 * Centralized date formatting utility.
 * All dates across the app use MM/DD/YYYY format.
 */

/**
 * Format a date as MM/DD/YYYY
 * e.g. 01/15/2026
 */
export function formatDate(date: Date | string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Format a date as M/D/YYYY (no leading zeros)
 * e.g. 1/15/2026
 */
export function formatDateShort(date: Date | string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/**
 * Format a date as Mon DD (short, for compact displays)
 * e.g. Jan 15
 */
export function formatDateCompact(date: Date | string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a date with weekday: Mon, MM/DD/YYYY
 * e.g. Tue, 01/15/2026
 */
export function formatDateWithDay(date: Date | string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday}, ${formatDate(d)}`;
}

/**
 * Date-only values (`activation_date`, `event_date`, `week_start_date`) come out
 * of Postgres as `YYYY-MM-DD` and the services turn them into Dates with
 * `new Date('YYYY-MM-DD')`, which lands on UTC midnight. Reading those Dates
 * back with UTC getters is therefore the only lossless way to recover the
 * calendar day the user actually picked, so the helpers below normalise both
 * strings and Dates to a UTC-midnight timestamp before doing any day math.
 */
function toUtcMidnight(date: Date | string): number | null {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return null;
    return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }
  if (isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Whole days between today and a date-only value. Positive = in the future,
 * negative = in the past, 0 = today. Returns null for unparseable input.
 *
 * "Today" is the viewer's local calendar day, mapped onto the same UTC-midnight
 * frame as the value being compared, so the answer is a whole number of days
 * regardless of the viewer's timezone.
 */
export function daysFromToday(date: Date | string, now: Date = new Date()): number | null {
  const target = toUtcMidnight(date);
  if (target === null) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/**
 * Compact relative day label for a date-only value.
 * e.g. `13d out` (future), `69d ago` (past), `today`.
 * Returns '' when the date cannot be read.
 */
export function formatRelativeDays(date: Date | string, now: Date = new Date()): string {
  const days = daysFromToday(date, now);
  if (days === null) return '';
  if (days === 0) return 'today';
  return days > 0 ? `${days}d out` : `${Math.abs(days)}d ago`;
}
