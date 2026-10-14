/**
 * Calendar-month arithmetic, shared by anything that has to tell a customer a
 * future billing date.
 *
 * WHY THIS IS NOT A ONE-LINER. `setMonth(getMonth() + 1)` on 31 January gives
 * 3 March, because 31 February does not exist and JavaScript rolls over instead
 * of clamping. Used for billing copy that is wrong by two days in one direction
 * — promising a customer a discount lasts longer than it does, or that billing
 * restarts later than it will. Stripe anchors to the billing cycle and clamps
 * to the shorter month, so this does the same.
 *
 * Extracted because two features need it (the retention discount's "billing
 * resumes on" and the pause's "billing restarts on") and a second copy would
 * eventually only get one of the fixes.
 *
 * All UTC: these dates come from and go back to Stripe timestamps, and doing
 * the arithmetic in local time would shift a date across a boundary for anyone
 * east or west of the server.
 */

/**
 * Add whole calendar months, clamping the day to the end of the target month.
 *
 * Returns null for unparseable input or a negative count rather than an
 * Invalid Date, so a bad value shows as "no date" instead of the string
 * "Invalid Date" in front of a customer.
 */
export function addMonthsClamped(iso: string | null, months: number): string | null {
  if (!iso) return null;
  const start = new Date(iso);
  if (!Number.isFinite(start.getTime())) return null;
  if (!Number.isFinite(months) || months < 0) return null;

  const day = start.getUTCDate();
  const target = new Date(start.getTime());

  // Move to the 1st BEFORE shifting the month, so a 29th-31st cannot roll the
  // month over on its own and land two months out.
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + Math.trunc(months));

  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}
