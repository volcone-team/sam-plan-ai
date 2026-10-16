/**
 * Telling a customer what their discount actually did.
 *
 * WHY THIS EXISTS. Accepting a retention offer changed nothing visible. The
 * subscription panel renders the plan's LIST price and "Renews 14 Nov", and
 * `/api/billing/me` deliberately skipped reading Stripe's discount because
 * that endpoint loads on every Settings visit. Reasonable for deciding whether
 * to OFFER a discount — but it was never revisited for showing one.
 *
 * So someone who claimed "next month free" or "50% off for 2 months" saw the
 * full price, the same renewal date, and no acknowledgement anywhere. The only
 * way to check was to re-enter the cancellation flow, where they would be told
 * they had already used their one offer.
 *
 * No Stripe SDK, no database, no React — just the arithmetic and the wording,
 * so both can be tested without a network.
 */

/** Minor units, as Stripe stores money. */
export interface ActiveDiscountInput {
  /** The Stripe coupon id, for support to trace. */
  couponId: string | null;
  percentOff: number | null;
  amountOff: number | null;
  /** Stripe's coupon duration: 'once' | 'repeating' | 'forever'. */
  duration: string | null;
  durationInMonths: number | null;
  /** What the next invoice will actually total, from Stripe's own preview. */
  nextChargeMinor: number | null;
  /** What it would have totalled without the discount. */
  standardChargeMinor: number | null;
  /** 'usd', 'gbp' — lower case, as Stripe reports it. */
  currency: string | null;
  /** monthly | annual, for the "then £X/mo" tail. */
  billingCycle: string | null;
}

export interface ActiveDiscount {
  couponId: string | null;
  /** "£74.50 due next" — the number that was missing. */
  nextCharge: string | null;
  /** "50% off for 2 months" */
  summary: string;
  /** "then £149.00/mo" — null when the discount never ends. */
  afterwards: string | null;
  /** How much this invoice saves them, for emphasis. Null when unknown. */
  saving: string | null;
}

/**
 * Pull the coupon id out of a Stripe discount, whichever shape it arrives in.
 *
 * THE SHAPE CHANGED AND IS NOT OURS TO PIN. Under API version
 * 2026-08-26.dahlia — the one this account uses — a subscription's discount
 * looks like:
 *
 *   { id: "di_…", source: { coupon: "sam_retention_…", type: "coupon" } }
 *
 * There is no `coupon` object at all, and `expand: ["discounts.coupon"]` does
 * not produce one because the field does not exist on that version. Older
 * versions nest the full coupon under `discount.coupon`, and some return it as
 * a bare string id.
 *
 * All three are handled for the same reason webhook-logic.ts reads two payload
 * shapes: a Stripe object's version is decided by the key and the endpoint
 * that created it, not by what this code expects today. Reading only one shape
 * is how a discount silently stops being displayed after an API upgrade.
 */
export function couponIdFromDiscount(discount: unknown): string | null {
  if (!discount || typeof discount !== "object") return null;

  const d = discount as {
    source?: { coupon?: unknown } | null;
    coupon?: unknown;
  };

  // Current shape: the coupon id lives under `source`.
  const fromSource = d.source?.coupon;
  if (typeof fromSource === "string" && fromSource) return fromSource;
  if (fromSource && typeof fromSource === "object") {
    const id = (fromSource as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }

  // Legacy shape: a nested coupon object, or a bare id.
  if (typeof d.coupon === "string" && d.coupon) return d.coupon;
  if (d.coupon && typeof d.coupon === "object") {
    const id = (d.coupon as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }

  return null;
}

const SYMBOLS: Record<string, string> = {
  usd: "$",
  gbp: "£",
  eur: "€",
  cad: "CA$",
  aud: "A$",
};

/**
 * Minor units to a display string.
 *
 * Exported because the panel needs to format the standard price alongside the
 * discounted one, and two formatters would eventually disagree about rounding.
 */
export function formatMinor(minor: number | null, currency: string | null): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;

  const symbol = SYMBOLS[(currency ?? "usd").toLowerCase()] ?? "";
  const major = minor / 100;

  /*
   * Whole amounts drop the decimals: "£49" reads as a price, "£49.00" reads as
   * an invoice. Anything with pence keeps them, because "£74.5" is wrong.
   */
  // Thousands separators either way: "$1,200", "$1,234.50".
  const digits = Number.isInteger(major) ? 0 : 2;
  const text = major.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${symbol}${text}`;
}

/** "/mo" or "/yr", matching how the plan is billed. */
function cycleSuffix(billingCycle: string | null): string {
  return billingCycle === "annual" ? "/yr" : "/mo";
}

/**
 * What the discount is, in words.
 *
 * Describes the COUPON rather than the computed figures, because that is what
 * the customer agreed to — "50% off for 2 months" is the promise, and the
 * amount is its consequence.
 */
function summarise(input: ActiveDiscountInput): string {
  const { percentOff, amountOff, duration, durationInMonths, currency } = input;

  const magnitude =
    typeof percentOff === "number" && percentOff > 0
      ? // 8.33% is a month off an annual plan; nobody wants to read "8.33% off".
        percentOff >= 99
        ? "Free"
        : `${Number(percentOff.toFixed(2))}% off`
      : typeof amountOff === "number" && amountOff > 0
        ? `${formatMinor(amountOff, currency)} off`
        : "Discount applied";

  if (duration === "forever") return `${magnitude}, for as long as you subscribe`;

  if (duration === "repeating" && typeof durationInMonths === "number" && durationInMonths > 0) {
    return `${magnitude} for ${durationInMonths} month${durationInMonths === 1 ? "" : "s"}`;
  }

  // 'once' — a single invoice. Said as "your next payment" rather than
  // "1 month", because on an annual plan one invoice is a year.
  return `${magnitude} on your next payment`;
}

/**
 * The discount line for the subscription panel, or null when there is nothing
 * to say.
 *
 * Returns null rather than a placeholder when no discount is active: an
 * "no discount" row would be noise on every other account.
 */
export function describeActiveDiscount(
  input: ActiveDiscountInput | null | undefined
): ActiveDiscount | null {
  if (!input) return null;

  const hasPercent = typeof input.percentOff === "number" && input.percentOff > 0;
  const hasAmount = typeof input.amountOff === "number" && input.amountOff > 0;
  if (!hasPercent && !hasAmount) return null;

  const nextCharge = formatMinor(input.nextChargeMinor, input.currency);

  /**
   * The saving is only claimed when BOTH figures are known and it is positive.
   *
   * A preview can be unavailable — a cancelled subscription has no upcoming
   * invoice — and inventing "you save £X" from one number would be worse than
   * omitting it.
   */
  const saving =
    typeof input.nextChargeMinor === "number" &&
    typeof input.standardChargeMinor === "number" &&
    input.standardChargeMinor > input.nextChargeMinor
      ? formatMinor(input.standardChargeMinor - input.nextChargeMinor, input.currency)
      : null;

  /**
   * What they pay once it lapses. Omitted for a 'forever' coupon, which never
   * does, and when the standard price is unknown.
   */
  const standard = formatMinor(input.standardChargeMinor, input.currency);
  const afterwards =
    input.duration !== "forever" && standard
      ? `then ${standard}${cycleSuffix(input.billingCycle)}`
      : null;

  return {
    couponId: input.couponId ?? null,
    nextCharge,
    summary: summarise(input),
    afterwards,
    saving,
  };
}
