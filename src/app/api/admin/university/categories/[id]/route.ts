import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { isUuid, normaliseCategoryInput } from "@/lib/university/access";
import { deleteCategory, updateCategory } from "@/lib/university/admin-repo";
import {
  adminClient,
  errorResponse,
  hasDisplayOrder,
  invalidBody,
  logUniversityAction,
  readJsonObject,
} from "@/lib/university/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ error: "not_found", message: "Category not found." }, { status: 404 });
}

/**
 * PATCH → update a category. ANY ADMIN. Same body as POST; the slug never
 * changes. Without displayOrder the current order is kept.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return notFound();

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseCategoryInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const category = await updateCategory(db, id, parsed.value, { hasDisplayOrder: hasDisplayOrder(body) });

    await logUniversityAction(db, check.userId, "university.category_updated", {
      type: "university_category",
      id: category.id,
      label: category.name,
    }, { isPublished: category.isPublished });

    return NextResponse.json(category);
  } catch (err: unknown) {
    return errorResponse(err, "PATCH category");
  }
}

/**
 * DELETE → delete an EMPTY category. ANY ADMIN.
 * 409 { error: "category_not_empty" } while it still has resources: the FK
 * cascades, so deleting it would silently take its content with it.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return notFound();

    const db = adminClient();
    const deleted = await deleteCategory(db, id);

    await logUniversityAction(db, check.userId, "university.category_deleted", {
      type: "university_category",
      id: deleted.id,
      label: deleted.name,
    });

    return NextResponse.json({ deleted: true, id: deleted.id });
  } catch (err: unknown) {
    return errorResponse(err, "DELETE category");
  }
}
