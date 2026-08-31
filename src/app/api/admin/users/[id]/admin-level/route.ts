import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";

/**
 * PATCH /api/admin/users/[id]/admin-level
 *
 * Promote or demote a user's admin status. SUPER ADMIN ONLY.
 *
 * Body: { adminLevel: "super_admin" | "admin" | null }
 *   - "super_admin" -> is_admin=true, admin_level=super_admin
 *   - "admin"       -> is_admin=true, admin_level=admin
 *   - null          -> is_admin=false, admin_level=null (revoke admin)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { adminLevel } = body;

    console.log("[admin-level] Request to set user", id, "to level:", adminLevel);

    // Validate
    if (adminLevel !== null && !["super_admin", "admin"].includes(adminLevel)) {
      return NextResponse.json({ error: "adminLevel must be 'super_admin', 'admin', or null." }, { status: 400 });
    }

    // Only super admins can change admin levels
    const check = await requireSuperAdmin();
    if (!check.ok) {
      console.log("[admin-level] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    // Guard: super admin cannot demote themselves (avoid lockout)
    if (id === check.userId && adminLevel !== "super_admin") {
      console.log("[admin-level] Blocked self-demotion");
      return NextResponse.json({ error: "You cannot remove your own super admin status." }, { status: 400 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const isAdmin = adminLevel !== null;

    const { error } = await adminClient
      .from("profiles")
      .update({ admin_level: adminLevel, is_admin: isAdmin })
      .eq("id", id);

    if (error) {
      console.error("[admin-level] Update error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin-level] User", id, "set to", adminLevel, "(is_admin:", isAdmin, ")");

    return NextResponse.json({ success: true, adminLevel, isAdmin });
  } catch (err: any) {
    console.error("[admin-level] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
