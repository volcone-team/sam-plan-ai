import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/plan/suggestions
 *
 * Returns the current PENDING enhancement suggestions for the user's company.
 * Used by the /enhance-plan review screen.
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      return NextResponse.json({ suggestions: [] });
    }

    const { data, error } = await supabase
      .from("plan_suggestions")
      .select("*")
      .eq("company_id", profile.company_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[plan/suggestions] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[plan/suggestions] Found", data?.length || 0, "pending suggestions");

    const suggestions = (data || []).map((s) => ({
      id: s.id,
      batchId: s.batch_id,
      type: s.suggestion_type,
      targetId: s.target_id,
      targetLabel: s.target_label,
      title: s.title,
      rationale: s.rationale,
      current: s.current_value,
      proposed: s.proposed_value,
      status: s.status,
    }));

    return NextResponse.json({ suggestions });
  } catch (err: any) {
    console.error("[plan/suggestions] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
