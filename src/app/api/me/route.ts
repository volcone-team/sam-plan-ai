import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/me
 *
 * Returns the authenticated user's profile.
 *
 * Authenticates via cookies (anon key), then reads the profile with the
 * service role so RLS can never be the reason a user fails to load their
 * own profile. This is the single source of truth for AuthProvider.
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
      console.log("[api/me] No session");
      return NextResponse.json({ user: null }, { status: 200 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error } = await adminClient
      .from("profiles")
      .select("company_id, first_name, last_name, role, is_active, is_admin, admin_level")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      console.error("[api/me] Profile missing for", user.email, error?.message);
      // No profile: report it rather than silently pointing at another company.
      return NextResponse.json({
        user: {
          id: user.id,
          email: user.email || null,
          companyId: null,
          firstName: null,
          lastName: null,
          role: null,
          isActive: true,
          isAdmin: false,
          adminLevel: null,
          profileMissing: true,
        },
      });
    }

    const meta = user.user_metadata || {};

    console.log("[api/me]", user.email, "| company:", profile.company_id, "| role:", profile.role, "| admin_level:", profile.admin_level, "| active:", profile.is_active);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email || null,
        companyId: profile.company_id,
        firstName: profile.first_name || meta.first_name || meta.firstName || null,
        lastName: profile.last_name || meta.last_name || meta.lastName || null,
        role: profile.role || null,
        isActive: profile.is_active ?? true,
        isAdmin: profile.is_admin ?? false,
        adminLevel: profile.admin_level ?? null,
        profileMissing: false,
      },
    });
  } catch (err: any) {
    console.error("[api/me] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
