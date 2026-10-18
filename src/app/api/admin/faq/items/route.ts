import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { normaliseFaqItemInput } from "@/lib/faq/faq";
import { createFaqItem } from "@/lib/faq/admin-repo";
import {
  adminClient,
  faqErrorResponse,
  hasDisplayOrder,
  invalidBody,
  logFaqAction,
  readJsonObject,
} from "@/lib/faq/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST → create an FAQ item. ANY ADMIN.
 * Body: { categoryId, question, answer, status?, displayOrder? }
 * status defaults to "draft". Without displayOrder the item is appended to its
 * category. Returns 201 FaqItem.
 */
export async function POST(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseFaqItemInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const item = await createFaqItem(db, parsed.value, check.userId, { hasDisplayOrder: hasDisplayOrder(body) });

    await logFaqAction(db, check.userId, "faq.item_created", {
      type: "faq_item",
      id: item.id,
      label: item.question,
    }, { status: item.status, categoryId: item.categoryId });

    return NextResponse.json(item, { status: 201 });
  } catch (err: unknown) {
    return faqErrorResponse(err, "POST items");
  }
}
