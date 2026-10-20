import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { serviceClient } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { checkLiveLimit, liveLimitResponse } from "@/lib/billing/live-limits";
import { requirePermission } from "@/lib/require-permission";
import { parseCreateProductRequest } from "@/lib/products/create-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/products — create one product from the Products page.
 *
 * Server-side so the plan's `max_products` can be enforced. This used to be a
 * direct browser insert (productService.createProduct), which nothing could
 * limit.
 *
 * PERMISSION is the page's own gate: `products.create` (owner and operator).
 * Company comes from the caller's profile, never the body.
 *
 * Responses:
 *   201 { product } — the inserted row
 *   400 { error } — malformed body
 *   401 / 403 { error } — not signed in / role may not create
 *   402 / 403 { error, code: "limit_reached" | "not_included", message }
 *   500 { error }
 */
export async function POST(request: NextRequest) {
  try {
    const check = await requirePermission("products.create");
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const { companyId } = check;

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = parseCreateProductRequest(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const req = parsed.value;

    const db = serviceClient();

    // Live count of ACTIVE products; deleting one frees a slot.
    const limit = await checkLiveLimit(db, companyId, LIMIT_KEYS.MAX_PRODUCTS, 1);
    if (!limit.ok) return liveLimitResponse(limit);

    const { data, error } = await db
      .from("products")
      .insert({
        company_id: companyId,
        name: req.name,
        description: req.description,
        price: req.price,
        revenue_type: req.revenueType,
        ticket_tier: req.ticketTier,
        is_active: true,
        display_order: req.displayOrder,
      })
      .select("*")
      .single();

    if (error || !data) {
      console.error("[products/create] insert failed:", error?.message);
      return NextResponse.json({ error: error?.message || "Could not save the product." }, { status: 500 });
    }

    return NextResponse.json({ product: data }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[products/create] failed:", message);
    return NextResponse.json({ error: "Could not save the product." }, { status: 500 });
  }
}
