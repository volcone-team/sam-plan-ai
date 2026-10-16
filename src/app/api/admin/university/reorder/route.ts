import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { normaliseReorderInput, reorder } from "@/lib/university/admin-repo";
import {
  adminClient,
  errorResponse,
  invalidBody,
  logUniversityAction,
  readJsonObject,
} from "@/lib/university/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT → reorder categories, or the resources of one category. ANY ADMIN.
 *
 * Body: { kind: "category" | "resource", ids: string[] }
 * Writes display_order 10, 20, 30… in the given order. The list must be the
 * complete set (all categories, or all resources of a single category).
 *
 * NOT TRANSACTIONAL: one UPDATE per row. A failure midway leaves a mixed but
 * harmless order; reordering again fixes it.
 */
export async function PUT(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseReorderInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    await reorder(db, parsed.value);

    await logUniversityAction(db, check.userId, "university.reordered", {
      type: parsed.value.kind === "category" ? "university_category" : "university_resource",
      id: null,
      label: `${parsed.value.ids.length} ${parsed.value.kind}(s)`,
    }, { ids: parsed.value.ids });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return errorResponse(err, "PUT reorder");
  }
}
