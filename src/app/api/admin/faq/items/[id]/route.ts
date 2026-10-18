import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { isUuid, normaliseFaqItemInput } from "@/lib/faq/faq";
import { deleteFaqItem, updateFaqItem } from "@/lib/faq/admin-repo";
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

/**
 * PATCH → update an item. ANY ADMIN. Full body as for POST; the slug never
 * changes. Without displayOrder the current order is kept (or appended, when
 * the item moves to another category).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return faqNotFound("Question");

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseFaqItemInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const item = await updateFaqItem(db, id, parsed.value, check.userId, { hasDisplayOrder: hasDisplayOrder(body) });

    await logFaqAction(db, check.userId, "faq.item_updated", {
      type: "faq_item",
      id: item.id,
      label: item.question,
    }, { status: item.status, categoryId: item.categoryId });

    return NextResponse.json(item);
  } catch (err: unknown) {
    return faqErrorResponse(err, "PATCH item");
  }
}

/** DELETE → delete an item. ANY ADMIN. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id: rawId } = await params;
    const id = rawId.toLowerCase();
    if (!isUuid(id)) return faqNotFound("Question");

    const db = adminClient();
    const deleted = await deleteFaqItem(db, id);

    await logFaqAction(db, check.userId, "faq.item_deleted", {
      type: "faq_item",
      id: deleted.id,
      label: deleted.question,
    });

    return NextResponse.json({ deleted: true, id: deleted.id });
  } catch (err: unknown) {
    return faqErrorResponse(err, "DELETE item");
  }
}
