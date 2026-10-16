/**
 * Shared plumbing for the SAM University admin routes
 * (`src/app/api/admin/university/**`): service-role client, body parsing,
 * error-to-response mapping and the audit log call.
 */
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity-log";
import { UniversityAdminError } from "./admin-repo";

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Parsed JSON object body, or `null` when it is not valid JSON / not an object. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function invalidBody(): NextResponse {
  return NextResponse.json(
    { error: "invalid", errors: {}, message: "Request body must be a JSON object." },
    { status: 400 }
  );
}

/** Did the caller actually send a display order? (Absent ⇒ append / keep.) */
export function hasDisplayOrder(body: Record<string, unknown>): boolean {
  const v = body.displayOrder;
  return v !== undefined && v !== null && v !== "";
}

/** Map any thrown value to a JSON response. */
export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof UniversityAdminError) {
    const body: Record<string, unknown> = { error: err.code, message: err.message };
    if (err.errors) body.errors = err.errors;
    return NextResponse.json(body, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[admin/university] ${context} error:`, message);
  return NextResponse.json({ error: "internal", message: message || "Internal error" }, { status: 500 });
}

/** Audit-log an admin action. Never throws (logActivity's contract). */
export async function logUniversityAction(
  db: SupabaseClient,
  userId: string,
  action: string,
  target: { type: string; id: string | null; label: string | null },
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { data: actor } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
  await logActivity(
    {
      actorUserId: userId,
      actorEmail: (actor as { email?: string } | null)?.email ?? null,
      action,
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      metadata,
    },
    db
  );
}
