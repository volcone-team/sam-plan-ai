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
