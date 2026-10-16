import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { isUuid, normaliseResourceInput } from "@/lib/university/access";
import { deleteResource, updateResource } from "@/lib/university/admin-repo";
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
  return NextResponse.json({ error: "not_found", message: "Resource not found." }, { status: 404 });
}

/**
 * PATCH → update a resource. ANY ADMIN. Full body as for POST; the slug never
 * changes. Plan links are REPLACED with `planIds` (all removed when isFree).
 * Without displayOrder the current order is kept (or appended, when the
 * resource moves to another category).
 *
 * NOT TRANSACTIONAL — see POST /api/admin/university/resources.
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

    const parsed = normaliseResourceInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const resource = await updateResource(db, id, parsed.value, check.userId, {
      hasDisplayOrder: hasDisplayOrder(body),
    });

    await logUniversityAction(db, check.userId, "university.resource_updated", {
      type: "university_resource",
      id: resource.id,
      label: resource.title,
    }, { status: resource.status, isFree: resource.isFree, planIds: resource.planIds });

    return NextResponse.json(resource);
  } catch (err: unknown) {
    return errorResponse(err, "PATCH resource");
  }
}

/** DELETE → delete a resource; its plan links cascade. ANY ADMIN. */
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
    const deleted = await deleteResource(db, id);

    await logUniversityAction(db, check.userId, "university.resource_deleted", {
      type: "university_resource",
      id: deleted.id,
      label: deleted.title,
    });

    return NextResponse.json({ deleted: true, id: deleted.id });
  } catch (err: unknown) {
    return errorResponse(err, "DELETE resource");
  }
}
