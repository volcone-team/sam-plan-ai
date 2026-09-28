import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type PlanEditorCheck =
  | { ok: true; userId: string; companyId: string; role: string }
  | { ok: false; status: number; error: string };

/** Roles allowed to generate, regenerate, reset or delete plan data. */
const PLAN_EDITOR_ROLES = ["owner", "operator"];

/**
 * Requires the caller to be a company member whose role may modify the plan
 * (owner or operator). team_member and viewer are read-only with respect to
 * plan generation/reset.
 */
export async function requirePlanEditor(): Promise<PlanEditorCheck> {
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
    console.log("[requirePlanEditor] Denied: no session");
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.company_id) {
    console.log("[requirePlanEditor] Denied: no company for user", user.id);
    return { ok: false, status: 400, error: "No company found" };
  }

  const role: string = profile.role || "";
  if (!PLAN_EDITOR_ROLES.includes(role)) {
    console.log("[requirePlanEditor] Denied:", user.id, "| role:", role || "(none)");
    return { ok: false, status: 403, error: "Your role cannot modify the plan." };
  }

  return { ok: true, userId: user.id, companyId: profile.company_id, role };
}
