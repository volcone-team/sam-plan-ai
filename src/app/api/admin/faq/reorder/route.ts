import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { normaliseFaqReorderInput, reorderFaq } from "@/lib/faq/admin-repo";
import {
  adminClient,
  faqErrorResponse,
  invalidBody,
  logFaqAction,
  readJsonObject,
} from "@/lib/faq/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT → reorder categories, or the items of one category. ANY ADMIN.
 *
 * Body: { kind: "category" | "item", ids: string[] }
 * Writes display_order 10, 20, 30… in the given order. The list must be the
 * complete set (all categories, or all items of a single category).
 */
export async function PUT(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseFaqReorderInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    await reorderFaq(db, parsed.value);

    await logFaqAction(db, check.userId, "faq.reordered", {
      type: parsed.value.kind === "category" ? "faq_category" : "faq_item",
      id: null,
      label: `${parsed.value.ids.length} ${parsed.value.kind}(s)`,
    }, { ids: parsed.value.ids });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return faqErrorResponse(err, "PUT reorder");
  }
}
