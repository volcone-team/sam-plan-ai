/**
 * Totals for an initiative's Results tab.
 *
 * Each total must equal the sum of the rows listed beneath it (requirement 2.4).
 * Summing float dollars drifts (0.1 + 0.2 !== 0.3), so every amount is rounded
 * to integer cents first, summed as integers, then converted back. Rows are
 * displayed at 2-dp, so this is exactly the sum a reader would compute.
 *
 * `results.actual_spend` is legacy (decision D1): spend now lives in Expenses.
 * It is reported separately as `legacySpend` and never added to a total.
 */
import { formatMoney, formatMoneyPrecise } from "@/lib/format-money";

/** Structural, so the component's Result type fits without a mapping step. */
export interface ResultsTabResultRow {
  actualRevenue: number;
  actualSpend?: number | null;
}

/** Structural, so the component's Expense type fits without a mapping step. */
export interface ResultsTabExpenseRow {
  amount: number;
}

export interface ResultsTabSummary {
  totalRevenue: number;
  totalExpenses: number;
  /** Σ legacy results.actual_spend. Shown read-only; not in any total. */
  legacySpend: number;
  hasLegacySpend: boolean;
}

/** Amount in integer cents; non-finite (NaN, ±Infinity, null, undefined) counts as 0. */
function toCents(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function sumCents(values: Array<number | null | undefined>): number {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return cents / 100;
}

export function summariseResultsTab(
  results: readonly ResultsTabResultRow[],
  expenses: readonly ResultsTabExpenseRow[]
): ResultsTabSummary {
  const totalRevenue = sumCents(results.map((r) => r.actualRevenue));
  const totalExpenses = sumCents(expenses.map((e) => e.amount));
  const legacySpend = sumCents(results.map((r) => r.actualSpend));
  return { totalRevenue, totalExpenses, legacySpend, hasLegacySpend: legacySpend > 0 };
}

export type MoneyFormatter = (value: number | null | undefined) => string;

/**
 * One formatter per section, so a total and its rows share precision:
 * whole dollars when every amount is whole, otherwise cents.
 */
export function pickMoneyFormatter(
  amounts: ReadonlyArray<number | null | undefined>
): MoneyFormatter {
  const allWhole = amounts.every((a) => toCents(a) % 100 === 0);
  return allWhole ? formatMoney : formatMoneyPrecise;
}
