import type { ProductTicketTier, RecurringInterval, RevenueType } from "@/types";

/**
 * The body of POST /api/products — the Products page's "Add Product" form.
 *
 * Company is NOT in the body: the route takes it from the caller's profile, so
 * a client cannot create a product in another company.
 */
export interface CreateProductRequest {
  name: string;
  description: string;
  price: number;
  revenueType: RevenueType;
  /** 'month' | 'year' for a recurring product (default 'month'); null for one-time. */
  recurringInterval: RecurringInterval | null;
  ticketTier: ProductTicketTier;
  displayOrder: number;
}

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const REVENUE_TYPES: readonly RevenueType[] = ["one-time", "recurring"];
const TIERS: readonly ProductTicketTier[] = ["low", "mid", "high"];
const INTERVALS: readonly RecurringInterval[] = ["month", "year"];

type Parsed = { ok: true; value: CreateProductRequest } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseCreateProductRequest(body: unknown): Parsed {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body." };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "A product needs a name." };
  if (name.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters.` };

  const price = typeof body.price === "number" ? body.price : Number.NaN;
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: "Price must be a number of 0 or more." };
  }

  const description = typeof body.description === "string" ? body.description.slice(0, MAX_DESCRIPTION) : "";

  const revenueType = (body.revenueType ?? "one-time") as RevenueType;
  if (!REVENUE_TYPES.includes(revenueType)) return { ok: false, error: "Unknown revenue type." };

  let recurringInterval: RecurringInterval | null = null;
  if (revenueType === "recurring") {
    const interval = (body.recurringInterval ?? "month") as RecurringInterval;
    if (!INTERVALS.includes(interval)) return { ok: false, error: "Choose per month or per year." };
    recurringInterval = interval;
  }
  const ticketTier = (body.ticketTier ?? "mid") as ProductTicketTier;
  if (!TIERS.includes(ticketTier)) return { ok: false, error: "Unknown ticket tier." };

  const displayOrder =
    typeof body.displayOrder === "number" && Number.isInteger(body.displayOrder) && body.displayOrder >= 0
      ? body.displayOrder
      : 0;

  return { ok: true, value: { name, description, price, revenueType, recurringInterval, ticketTier, displayOrder } };
}
