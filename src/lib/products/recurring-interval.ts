/**
 * `products.recurring_interval` (migration 055) helpers.
 *
 * Writes include the column; until 055 is applied the database rejects it as
 * an unknown column, and the write is retried once without it, so saving a
 * product never fails because the migration is pending. The interval is then
 * simply not kept, and the product reads as monthly, as before.
 */
import type { RecurringInterval, RevenueType } from "@/types";

type WriteError = { code?: string | null; message?: string | null } | null | undefined;

/** True when the error is the missing `recurring_interval` column. */
export function isMissingIntervalColumn(error: WriteError): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "");
  return (error.code === "42703" || error.code === "PGRST204") && msg.includes("recurring_interval");
}

/** A payload with `recurring_interval` removed, or null when it had none. */
export function withoutInterval<T extends Record<string, unknown>>(row: T): T | null {
  if (!("recurring_interval" in row)) return null;
  const { recurring_interval: _drop, ...rest } = row;
  void _drop;
  return rest as T;
}

/** The interval to store: recurring keeps month | year (default month); one-time stores null. */
export function intervalFor(revenueType: RevenueType | string | null | undefined, interval: unknown): RecurringInterval | null {
  if (revenueType !== "recurring") return null;
  return interval === "year" ? "year" : "month";
}

/** Read a row's interval: null for one-time; an unrecorded recurring interval is 'month'. */
export function readInterval(revenueType: unknown, interval: unknown): RecurringInterval | null {
  if (revenueType !== "recurring") return null;
  return interval === "year" ? "year" : "month";
}

/** "/mo" or "/yr" after a price. */
export function intervalSuffix(interval: RecurringInterval | null | undefined): string {
  return interval === "year" ? "/yr" : "/mo";
}
