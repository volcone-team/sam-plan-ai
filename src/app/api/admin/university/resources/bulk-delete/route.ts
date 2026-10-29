import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { isUuid } from "@/lib/university/access";
import { deleteResources } from "@/lib/university/admin-repo";
import {
  adminClient,
  errorResponse,
  invalidBody,
  logUniversityAction,
  readJsonObject,
} from "@/lib/university/admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upper bound on one request's id list, so a body cannot carry an unbounded IN list. */
const MAX_IDS = 500;

/**
 * POST /api/admin/university/resources/bulk-delete → delete many resources.
 * ANY ADMIN, the same as deleting one.
 *
 *   { ids: uuid[] }   the selected resources (1–500)
 *   { all: true }     every resource in the catalogue (categories are kept)
 *
 *   200 { deleted: number, ids: string[] }  ids that no longer exist are ignored
 *   400 { error: "invalid", errors, message }
 *
 * Plan links cascade. Logged once, with the count and the titles.
 */
export async function POST(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    let target: string[] | "all";
    if (body.all === true) {
      target = "all";
    } else {
      const raw = Array.isArray(body.ids) ? body.ids : null;
      const ids = (raw ?? []).map((v) => (typeof v === "string" ? v.trim().toLowerCase() : v));
      if (!raw || ids.length === 0 || ids.length > MAX_IDS || !ids.every(isUuid)) {
        return NextResponse.json(
          {
            error: "invalid",
            errors: { ids: `Send 1 to ${MAX_IDS} resource ids, or { "all": true }.` },
            message: "Choose at least one resource to delete.",
          },
          { status: 400 }
        );
      }
      target = [...new Set(ids as string[])];
    }

    const db = adminClient();
    const deleted = await deleteResources(db, target);
    await logUniversityAction(
      db,
      check.userId,
      "university.resources_bulk_deleted",
      { type: "university_resource", id: null, label: `${deleted.length} resource${deleted.length === 1 ? "" : "s"}` },
      { all: target === "all", ids: deleted.map((r) => r.id), titles: deleted.map((r) => r.title) }
    );
    return NextResponse.json({ deleted: deleted.length, ids: deleted.map((r) => r.id) });
  } catch (err: unknown) {
    return errorResponse(err, "POST bulk-delete resources");
  }
}
