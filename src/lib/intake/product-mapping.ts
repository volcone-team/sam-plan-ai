/**
 * Translating intake answers into `products` column values.
 *
 * `products` was created in migration 001 with CHECK constraints, and its
 * vocabulary is NOT the intake's:
 *
 *   products.revenue_type  'one-time' | 'recurring'          (hyphenated)
 *   intake payment_type    'one_time' | 'recurring' | 'payment_plan'
 *
 *   products.ticket_tier   'low' | 'mid' | 'high'            (NOT NULL)
 *   intake price_level     'low' | 'mid' | 'high' | 'one_to_one'  (optional)
 *
 * Passing an intake value straight through wrote 'one_time' into a column that
 * only accepts 'one-time', so Postgres rejected the row and the whole "Build my
 * plan" request failed with `products_revenue_type_check`.
 *
 * Extracted here rather than left inline in the route because a constraint
 * mismatch is invisible until a real insert runs — it type-checks fine and only
 * fails against the live database. Tests are the only cheap way to catch it.
 */

/** Exactly what `products.revenue_type` permits. */
export type RevenueType = "one-time" | "recurring";

/** Exactly what `products.ticket_tier` permits. */
export type TicketTier = "low" | "mid" | "high";

/**
 * `intake_products.payment_type` -> `products.revenue_type`.
 *
 * A payment plan collapses to 'one-time': it is a single purchase split into
 * instalments, not revenue that renews. Treating it as recurring would inflate
 * every projection built from the product.
 *
 * Anything unrecognised (including null, from a product card where the question
 * was skipped) also becomes 'one-time', matching the column's own default
 * rather than overstating the business as subscription revenue.
 */
export function toRevenueType(value: unknown): RevenueType {
  return value === "recurring" ? "recurring" : "one-time";
}

/**
 * `intake_products.price_level` -> `products.ticket_tier`.
 *
 * One-on-one maps to 'high': it is priced per client, which in practice sits at
 * the top of the range, and the constraint has no fourth slot for it.
 *
 * An unanswered level becomes 'mid' — the column's own default. The column is
 * NOT NULL so null is not an option, and defaulting to 'high' would quietly
 * overstate the catalogue.
 */
export function toTicketTier(value: unknown): TicketTier {
  switch (value) {
    case "low":
    case "mid":
    case "high":
      return value;
    case "one_to_one":
      return "high";
    default:
      return "mid";
  }
}
