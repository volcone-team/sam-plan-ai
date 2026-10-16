import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { normaliseResourceInput } from "@/lib/university/access";
import { createResource } from "@/lib/university/admin-repo";
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
 * POST → create a SAM University resource. ANY ADMIN.
 *
 * Body: { categoryId, title, description?, type, url?, durationMinutes?,
 *         status, isFree?, planIds?, displayOrder? }
 * Without displayOrder the resource is appended to the end of its category.
 *
 * NOT TRANSACTIONAL: the resource row is written, then its plan links. If the
 * links fail the response is 500 `plan_links_failed` and the resource exists
 * with fewer plans than asked (admins-only at worst). Saving again fixes it.
 *
 * Returns the saved UniversityResource (201).
 */
export async function POST(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const body = await readJsonObject(req);
    if (!body) return invalidBody();

    const parsed = normaliseResourceInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid", errors: parsed.errors }, { status: 400 });
    }

    const db = adminClient();
    const resource = await createResource(db, parsed.value, check.userId, {
      hasDisplayOrder: hasDisplayOrder(body),
    });

    await logUniversityAction(db, check.userId, "university.resource_created", {
      type: "university_resource",
      id: resource.id,
      label: resource.title,
    }, { status: resource.status, isFree: resource.isFree, planIds: resource.planIds });

    return NextResponse.json(resource, { status: 201 });
  } catch (err: unknown) {
    return errorResponse(err, "POST resources");
  }
}
