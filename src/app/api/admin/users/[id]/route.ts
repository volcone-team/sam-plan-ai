import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/admin/users/[id]
 *
 * Returns detail for a single user including their company info.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminProfile?.is_admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get profile
    const { data: profile, error } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !profile) {
      console.log("[admin/users/id] User not found:", id);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get company name
    let companyName = null;
    if (profile.company_id) {
      const { data: company } = await adminClient
        .from("companies")
        .select("name")
        .eq("id", profile.company_id)
        .single();
      companyName = company?.name || null;
    }

    console.log("[admin/users/id] Found user:", profile.email, "company:", companyName);

    return NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        companyId: profile.company_id,
        companyName,
        role: profile.role,
        isActive: profile.is_active,
        isAdmin: profile.is_admin,
        createdAt: profile.created_at,
      },
    });
  } catch (err: any) {
    console.error("[admin/users/id] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/[id]
 *
 * Deactivates or fully deletes a user.
 * Query params:
 *   ?hard=true — permanently deletes the auth user (cascade deletes profile)
 *   default   — soft deactivate (is_active = false)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const hard = searchParams.get("hard") === "true";

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminProfile?.is_admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    // Can't delete yourself
    if (id === user.id) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (hard) {
      console.log("[admin/users/id] Hard deleting user:", id);
      const { error } = await adminClient.auth.admin.deleteUser(id);
      if (error) {
        console.error("[admin/users/id] Delete error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      console.log("[admin/users/id] Soft deactivating user:", id);
      const { error } = await adminClient
        .from("profiles")
        .update({ is_active: false })
        .eq("id", id);
      if (error) {
        console.error("[admin/users/id] Deactivate error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, action: hard ? "deleted" : "deactivated" });
  } catch (err: any) {
    console.error("[admin/users/id] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
