import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type AdminCheck =
  | { ok: true; userId: string; adminLevel: string; companyId: string | null }
  | { ok: false; status: number; error: string };

/**
 * Requires the caller to be an admin (admin OR super_admin).
 */
export async function requireAdmin(): Promise<AdminCheck> {
  return check(false);
}

/**
 * Requires the caller to be a super_admin specifically.
 */
export async function requireSuperAdmin(): Promise<AdminCheck> {
  return check(true);
}

async function check(needSuper: boolean): Promise<AdminCheck> {
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
    console.log("[requireAdmin] No session (needSuper:", needSuper, ")");
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, admin_level, company_id")
    .eq("id", user.id)
    .single();

  const level = profile?.admin_level || null;
  console.log("[requireAdmin]", user.email, "| is_admin:", profile?.is_admin, "| level:", level, "| needSuper:", needSuper);

  if (!profile?.is_admin) {
    return { ok: false, status: 403, error: "Admin access required" };
  }

  if (needSuper && level !== "super_admin") {
    return { ok: false, status: 403, error: "Super admin access required" };
  }

  return { ok: true, userId: user.id, adminLevel: level || "admin", companyId: profile.company_id };
}
