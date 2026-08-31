import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/plan/history/[id]
 *
 * Returns the full snapshot JSON for a specific plan version.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log("[plan/history/id] Loading snapshot:", id);

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

    const { data: snapshot, error } = await supabase
      .from("plan_snapshots")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !snapshot) {
      console.log("[plan/history/id] Not found:", id);
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }

    // Verify it belongs to user's company
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (snapshot.company_id !== profile?.company_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    console.log("[plan/history/id] Found:", snapshot.label, "| initiatives:", (snapshot.snapshot as any)?.initiatives?.length || 0);

    return NextResponse.json({
      snapshot: {
        id: snapshot.id,
        label: snapshot.label,
        createdAt: snapshot.created_at,
        data: snapshot.snapshot,
      },
    });
  } catch (err: any) {
    console.error("[plan/history/id] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
