import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { normaliseFaqCategoryInput } from "@/lib/faq/faq";
import { createFaqCategory } from "@/lib/faq/admin-repo";
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
 * POST → create an FAQ category. ANY ADMIN.
 * Body: { name, icon?, displayOrder?, isPublished? }
 * Without displayOrder the category is appended at the end. Returns 201 FaqCategory.
 */
export async function POST(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseFaqCategoryInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const category = await createFaqCategory(db, parsed.value, { hasDisplayOrder: hasDisplayOrder(body) });

    await logFaqAction(db, check.userId, "faq.category_created", {
      type: "faq_category",
      id: category.id,
      label: category.name,
    });

    return NextResponse.json(category, { status: 201 });
  } catch (err: unknown) {
    return faqErrorResponse(err, "POST categories");
  }
}
