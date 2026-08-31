import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * POST /api/admin/users/create
 *
 * Admin creates a new user and assigns them to an existing company.
 *
 * Body: { companyId, email, firstName, lastName, password, role }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyId, email, firstName, lastName, password, role } = body;

    console.log("[admin/users/create] Creating user:", email, "for company:", companyId);

    // Validate
    if (!companyId || !email || !firstName || !password || !role) {
      return NextResponse.json(
        { error: "Company, email, first name, password, and role are required." },
        { status: 400 }
      );
    }

    if (!["owner", "operator", "team_member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    // 1. Auth check — only admins
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

    if (!adminProfile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // 2. Service role client
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 3. Verify company exists
    const { data: company } = await adminClient
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }

    console.log("[admin/users/create] Company found:", company.name);

    // 4. Create auth user
    const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName || "",
      },
    });

    if (authError || !newUser?.user) {
      console.error("[admin/users/create] Auth error:", authError?.message);
      if (authError?.message?.includes("already")) {
        return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
      }
      return NextResponse.json({ error: authError?.message || "Failed to create user" }, { status: 500 });
    }

    console.log("[admin/users/create] Auth user created:", newUser.user.id);

    // 5. Wait for trigger, then fix profile
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Delete auto-created company from trigger
    const { data: autoProfile } = await adminClient
      .from("profiles")
      .select("company_id")
      .eq("id", newUser.user.id)
      .single();

    if (autoProfile?.company_id && autoProfile.company_id !== companyId) {
      await adminClient.from("companies").delete().eq("id", autoProfile.company_id);
      console.log("[admin/users/create] Cleaned up trigger company:", autoProfile.company_id);
    }

    // Update profile to target company
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({
        company_id: companyId,
        first_name: firstName,
        last_name: lastName || "",
        role,
        is_admin: false,
      })
      .eq("id", newUser.user.id);

    if (profileErr) {
      console.error("[admin/users/create] Profile update failed:", profileErr.message);
    }

    console.log("[admin/users/create] Done:", email, "→", company.name, "as", role);

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.user.id,
        email,
        firstName,
        lastName: lastName || "",
        role,
        companyName: company.name,
      },
    });
  } catch (err: any) {
    console.error("[admin/users/create] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
