import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { normaliseCategoryInput } from "@/lib/university/access";
import { createCategory } from "@/lib/university/admin-repo";
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

/**
 * POST → create a SAM University category. ANY ADMIN.
 * Body: { name, description?, icon?, displayOrder?, isPublished? }
 * Without displayOrder the category is appended at the end.
 * Returns the saved UniversityCategory (201).
 */
export async function POST(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseCategoryInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const category = await createCategory(db, parsed.value, { hasDisplayOrder: hasDisplayOrder(body) });

    await logUniversityAction(db, check.userId, "university.category_created", {
      type: "university_category",
      id: category.id,
      label: category.name,
    });

    return NextResponse.json(category, { status: 201 });
  } catch (err: unknown) {
    return errorResponse(err, "POST categories");
  }
}
