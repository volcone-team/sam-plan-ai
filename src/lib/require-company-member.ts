import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side "signed in and belongs to a company" check, for READ routes any
 * role may call (viewer included). Write routes use `requirePermission`.
 *
 * Returns { ok: true, userId, companyId, role } or { ok: false, status, error }
 * in the same shape as requirePermission, so callers handle both alike.
 */
export async function requireCompanyMember(): Promise<
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
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.company_id) return { ok: false, status: 400, error: "No company found" };
  return { ok: true, userId: user.id, companyId: profile.company_id, role: profile.role || "" };
}
