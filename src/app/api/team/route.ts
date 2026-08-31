import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/team
 *
 * Returns all team members for the requesting user's company.
 */
export async function GET() {
  try {
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
      console.log("[team] GET - No user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[team] GET - User:", user.email);

    // Use service role to bypass RLS for reliable lookup
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get current user's company
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile?.company_id) {
      console.log("[team] GET - No profile/company:", profileErr?.message);
      return NextResponse.json({ error: "No company found." }, { status: 400 });
    }

    console.log("[team] GET - Company:", profile.company_id, "| Role:", profile.role);

    // Get all members of this company
    const { data: members, error } = await adminClient
      .from("profiles")
      .select("id, email, first_name, last_name, role, is_active, created_at")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[team] GET - Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[team] GET - Found", members?.length || 0, "members");

    return NextResponse.json({
      members: (members || []).map((m) => ({
        id: m.id,
        email: m.email,
        firstName: m.first_name,
        lastName: m.last_name,
        role: m.role,
        isActive: m.is_active ?? true,
        createdAt: m.created_at,
      })),
    });
  } catch (err: any) {
    console.error("[team] GET Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
