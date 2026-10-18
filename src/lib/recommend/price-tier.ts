/**
 * Price tiers for the FIT "I" gate — "It's the right product".
 *
 * Two sides have to be put on the same scale:
 *
 *   - the INITIATIVE: the workbook's "Primary product price tier" column
 *     (`wb_initiative_library.price_tier`), free text such as "Low",
 *     "Low → Mid", "Mid → High" or "Mid/High";
 *   - the BUSINESS: what it sells, from `intake_products` — the real average
 *     price where given, otherwise the price level the user picked.
 *
 * Everything here is pure so each mapping can be tested against every real
 * string the workbook uses.
 */

export type PriceTier = "low" | "mid" | "high";

/** Ordered low to high, so a range can be filled in between its ends. */
export const PRICE_TIERS: readonly PriceTier[] = ["low", "mid", "high"];

/**
 * The thresholds.
 *
 * NOT defined by the client's workbook — neither "Start Here" nor
 * "2.5 Definitions" says what Low, Mid or High mean. These match the ranges
 * the intake ALREADY shows users beside the price-level choice
 * (PRICE_TIER_OPTIONS in src/lib/intake/schema.ts: "Under $500",
 * "$500 to $5,000", "$5,000 and up"), so a product is classed the same way the
 * user was told it would be. Awaiting the owner's confirmation; change both
 * places together.
 */
/** A price at or above this is Mid. Below it is Low. */
export const MID_TIER_MIN_PRICE = 500;
/** A price at or above this is High. */
export const HIGH_TIER_MIN_PRICE = 5000;

/**
 * A product price in dollars to its tier. Null for no price (unknown, which
 * the gate treats as "don't exclude"). Zero is a real price — a free product
 * is Low.
 */
export function productPriceTier(price: number | null | undefined): PriceTier | null {
  if (price === null || price === undefined || !Number.isFinite(price) || price < 0) return null;
  if (price >= HIGH_TIER_MIN_PRICE) return "high";
  if (price >= MID_TIER_MIN_PRICE) return "mid";
  return "low";
}

/**
 * `intake_products.price_level` to a tier.
 *
 * "one_to_one" ("Priced per client") is NOT a tier, so it reads as unknown
 * here. `toTicketTier` maps it to High for the products catalogue, but using
 * that guess to REMOVE initiatives would exclude on missing data.
 */
export function tierFromPriceLevel(level: unknown): PriceTier | null {
  return level === "low" || level === "mid" || level === "high" ? level : null;
}

/**
 * One intake product's tier: the real average price first (it is the number
 * the plan is built on), the picked price level when no price was given.
 */
export function intakeProductTier(product: {
  average_price?: unknown;
  price_level?: unknown;
}): PriceTier | null {
  const raw = product.average_price;
  const price =
    raw === null || raw === undefined || raw === "" ? null : Number(raw);
  return productPriceTier(price !== null && Number.isFinite(price) ? price : null)
    ?? tierFromPriceLevel(product.price_level);
}

/** "→", "->", "to", or a dash between two tiers means everything in between. */
const RANGE_CONNECTOR = /→|->|\bto\b|[-–—]/i;

/**
 * The workbook's tier text to the set of tiers it covers.
 *
 *   "Low"        -> {low}
 *   "Low → Mid"  -> {low, mid}
 *   "Low → High" -> {low, mid, high}   (a range includes what lies between)
 *   "Mid/High"   -> {mid, high}        (a list is taken as written)
 *
 * Null for blank or unparseable text, which the gate treats as "don't
 * exclude".
 */
export function parseInitiativeTierRange(raw: string | null | undefined): Set<PriceTier> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const found = (raw.toLowerCase().match(/\b(low|mid|high)\b/g) ?? []) as PriceTier[];
  if (found.length === 0) return null;

  const tiers = new Set<PriceTier>(found);
  if (found.length > 1 && RANGE_CONNECTOR.test(raw)) {
    const indexes = found.map((t) => PRICE_TIERS.indexOf(t));
    const from = Math.min(...indexes);
    const to = Math.max(...indexes);
    for (let i = from; i <= to; i++) tiers.add(PRICE_TIERS[i]);
  }
  return tiers;
}

const TIER_WORD: Record<PriceTier, string> = { low: "low", mid: "mid", high: "high" };

/** "low- to mid-priced", "high-priced" — for the rejection reason. */
export function describeTierRange(tiers: ReadonlySet<PriceTier>): string {
  const ordered = PRICE_TIERS.filter((t) => tiers.has(t));
  if (ordered.length === 1) return `${TIER_WORD[ordered[0]]}-priced`;
  return `${TIER_WORD[ordered[0]]}- to ${TIER_WORD[ordered[ordered.length - 1]]}-priced`;
}
