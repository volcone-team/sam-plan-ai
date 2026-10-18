import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { isUuid, normaliseFaqCategoryInput } from "@/lib/faq/faq";
import { deleteFaqCategory, updateFaqCategory } from "@/lib/faq/admin-repo";
import {
  adminClient,
  faqErrorResponse,
  faqNotFound,
  hasDisplayOrder,
  invalidBody,
  logFaqAction,
  readJsonObject,
} from "@/lib/faq/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH → update a category. ANY ADMIN. Same body as POST; the slug never changes. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return faqNotFound("Category");

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseFaqCategoryInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const category = await updateFaqCategory(db, id, parsed.value, { hasDisplayOrder: hasDisplayOrder(body) });

    await logFaqAction(db, check.userId, "faq.category_updated", {
      type: "faq_category",
      id: category.id,
      label: category.name,
    }, { isPublished: category.isPublished });

    return NextResponse.json(category);
  } catch (err: unknown) {
    return faqErrorResponse(err, "PATCH category");
  }
}

/**
 * DELETE → delete an EMPTY category. ANY ADMIN.
 * 409 { error: "category_not_empty" } while it still has questions (the FK
 * cascades, so deleting it would silently take them with it).
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return faqNotFound("Category");

    const db = adminClient();
    const deleted = await deleteFaqCategory(db, id);

    await logFaqAction(db, check.userId, "faq.category_deleted", {
      type: "faq_category",
      id: deleted.id,
      label: deleted.name,
    });

    return NextResponse.json({ deleted: true, id: deleted.id });
  } catch (err: unknown) {
    return faqErrorResponse(err, "DELETE category");
  }
}
