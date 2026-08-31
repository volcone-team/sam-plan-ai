import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/plan/history
 *
 * Returns list of plan snapshots for the user's company.
 * Lightweight — doesn't include the full JSON blob.
 */
export async function GET() {
  try {
    console.log("[plan/history] Loading snapshots...");

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
      return NextResponse.json({ snapshots: [] });
    }

    const { data: snapshots, error } = await supabase
      .from("plan_snapshots")
      .select("id, label, created_at")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[plan/history] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[plan/history] Found", snapshots?.length || 0, "snapshots");

    return NextResponse.json({
      snapshots: (snapshots || []).map((s) => ({
        id: s.id,
        label: s.label,
        createdAt: s.created_at,
      })),
    });
  } catch (err: any) {
    console.error("[plan/history] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
