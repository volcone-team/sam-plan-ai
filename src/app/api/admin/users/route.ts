import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/admin/users
 *
 * Returns all users across all companies.
 * Admin-only.
 *
 * Query params:
 *   ?search=text  — filters by name or email
 *   ?limit=50     — pagination limit
 *   ?offset=0     — pagination offset
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const filter = searchParams.get("filter") || "all"; // all | internal | customers
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
    const offset = Number(searchParams.get("offset")) || 0;

    // 1. Auth
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
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Verify admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    console.log("[admin/users] User:", user.email, "| is_admin:", profile?.is_admin);

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // 3. Service role client
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 4. Query profiles
    let query = adminClient
      .from("profiles")
      .select("id, email, first_name, last_name, company_id, role, is_active, is_admin, admin_level, created_at", { count: "exact" });

    if (search) {
      query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }

    if (filter === "internal") {
      query = query.eq("is_admin", true);
      console.log("[admin/users] Filtering: internal (admins) only");
    } else if (filter === "customers") {
      query = query.eq("is_admin", false);
      console.log("[admin/users] Filtering: customers only");
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data: users, error, count } = await query;

    if (error) {
      console.error("[admin/users] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin/users] Found", users?.length, "users, total:", count);

    // 5. Get company names for all users
    const companyIds = [...new Set((users || []).map((u) => u.company_id).filter(Boolean))];

    const { data: companies } = await adminClient
      .from("companies")
      .select("id, name")
      .in("id", companyIds.length > 0 ? companyIds : ["__none__"]);

    const companyNameMap = new Map<string, string>();
    for (const c of companies || []) {
      companyNameMap.set(c.id, c.name);
    }

    // 6. Format response
    const result = (users || []).map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      companyId: u.company_id,
      companyName: companyNameMap.get(u.company_id) || null,
      role: u.role,
      isActive: u.is_active,
      isAdmin: u.is_admin,
      adminLevel: u.admin_level ?? null,
      createdAt: u.created_at,
    }));

    console.log("[admin/users] Returning", result.length, "users");

    return NextResponse.json({
      users: result,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error("[admin/users] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
