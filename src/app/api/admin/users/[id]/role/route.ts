import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";

/**
 * PATCH /api/admin/users/[id]/role
 *
 * Change a customer's access role. Any admin can do this.
 *
 * Body: { role: "owner" | "operator" | "team_member" | "viewer" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { role } = body;

    console.log("[user/role] Request to set user", id, "to role:", role);

    if (!["owner", "operator", "team_member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[user/role] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Snapshot the previous role BEFORE updating, for the audit trail.
    const { data: before } = await adminClient
      .from("profiles")
      .select("role, company_id")
      .eq("id", id)
      .maybeSingle();

    const { data, error } = await adminClient
      .from("profiles")
      .update({ role })
      .eq("id", id)
      .select("id, email, role")
      .single();

    if (error) {
      console.error("[user/role] Update error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[user/role] User", data?.email, "role set to", data?.role);

    // Audit trail — never throws, never affects this response.
    const { data: actor } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: actor?.email ?? null,
        action: "user.role_changed",
        targetType: "user",
        targetId: id,
        targetLabel: data?.email ?? null,
        companyId: before?.company_id ?? null,
        metadata: { from: before?.role ?? null, to: data?.role ?? role },
      },
      adminClient
    );

    return NextResponse.json({ success: true, role: data?.role });
  } catch (err: any) {
    console.error("[user/role] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
