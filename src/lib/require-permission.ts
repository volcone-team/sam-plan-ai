import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { roleHasPermission, type Permission } from "@/lib/permissions";

/**
 * Server-side permission check for API routes.
 *
 * Returns { ok: true, userId, companyId, role } if the user has the permission,
 * or { ok: false, status, error } if not.
 *
 * Usage in an API route:
 *   const check = await requirePermission("initiatives.delete");
 *   if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
 */
export async function requirePermission(permission: Permission): Promise<
  | { ok: true; userId: string; companyId: string; role: string }
  | { ok: false; status: number; error: string }
> {
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
    console.log("[requirePermission] No user session for:", permission);
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.company_id) {
    console.log("[requirePermission] No company for user:", user.email);
    return { ok: false, status: 400, error: "No company found" };
  }

  const allowed = roleHasPermission(profile.role, permission);
  console.log("[requirePermission]", user.email, "| role:", profile.role, "| perm:", permission, "| allowed:", allowed);

  if (!allowed) {
    return { ok: false, status: 403, error: `Your role (${profile.role}) does not permit this action.` };
  }

  return { ok: true, userId: user.id, companyId: profile.company_id, role: profile.role };
}
