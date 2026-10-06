/**
 * Centralised monetary formatting.
 *
 * All figures a user READS are shown in full, comma-separated: $6,060,000 rather
 * than $6.06M. Abbreviation hid the number people came to the page for — on the
 * Year at a Glance goal cards, "$6.06M" could be anything from $6,055,000 to
 * $6,064,999, which is useless for a revenue target you are being held to.
 *
 * Eleven components had each grown their own copy of the same abbreviating
 * helper, so the rule could not be changed in one place. Everything now routes
 * through here.
 *
 * `formatAxisMoney` is the ONE deliberate exception: chart axis ticks have a
 * hard physical width, and twelve full figures along an axis either overflow or
 * wrap into illegibility. That is a layout constraint, not a reading preference.
 */

/** Whole dollars with separators: $6,060,000. The default for anything read. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

/**
 * Money with cents: $4,497.53. For invoices and recorded spend, where the
 * exact amount is the point and rounding would misstate what was charged.
 */
export function formatMoneyPrecise(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0.00";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Stripe amounts arrive in MINOR units (cents). Converting at the display edge
 * keeps the integer amount intact through storage and arithmetic, where float
 * dollars would accumulate rounding error.
 */
export function formatMoneyFromMinor(
  minorUnits: number | null | undefined,
  currency = "usd"
): string {
  if (minorUnits === null || minorUnits === undefined || !Number.isFinite(minorUnits)) {
    return currency.toUpperCase() === "USD" ? "$0.00" : "0.00";
  }
  const symbol = currency.toUpperCase() === "USD" ? "$" : "";
  const value = minorUnits / 100;
  const sign = value < 0 ? "-" : "";
  return `${sign}${symbol}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Abbreviated money, for CHART AXIS TICKS ONLY.
 *
 * Do not use this for a figure a user reads directly — that is `formatMoney`.
 * Axis labels are positioned at fixed intervals with only a few characters of
 * room, so full numbers there collide. The chart's tooltips and the table below
 * it still show exact values.
 */
export function formatAxisMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    // Trailing ".0" carries no information on an axis.
    const m = abs / 1_000_000;
    return `${sign}$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${Math.round(abs / 1_000)}K`;
  }
  return `${sign}$${Math.round(abs)}`;
}

/** Bare number with separators, for use where a currency symbol is already shown. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString("en-US");
}
