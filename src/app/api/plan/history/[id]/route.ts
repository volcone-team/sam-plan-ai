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


/**
 * DELETE /api/plan/history/[id]
 *
 * Permanently deletes a single plan snapshot from history.
 *
 * Only the snapshot row is removed - the user's CURRENT plan (initiatives,
 * tasks, projections, annual plan) is never touched. Deleting history is not
 * the same as deleting a plan.
 *
 * Restricted to owner/operator, matching the restore endpoint, since losing a
 * snapshot removes a recovery point.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log("[plan/history/id] Deleting snapshot:", id);

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
      .select("company_id, role")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      return NextResponse.json({ error: "No company found" }, { status: 400 });
    }
    if (!["owner", "operator"].includes(profile.role)) {
      return NextResponse.json({ error: "Your role cannot delete plan history." }, { status: 403 });
    }

    // Confirm the snapshot exists and belongs to this company before deleting.
    const { data: snapshot } = await supabase
      .from("plan_snapshots")
      .select("id, label, company_id")
      .eq("id", id)
      .single();

    if (!snapshot || snapshot.company_id !== profile.company_id) {
      console.log("[plan/history/id] Delete target not found or not owned:", id);
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }

    const { error: delErr } = await supabase
      .from("plan_snapshots")
      .delete()
      .eq("id", id)
      .eq("company_id", profile.company_id);

    if (delErr) {
      console.error("[plan/history/id] Delete failed:", delErr.message);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    console.log("[plan/history/id] Deleted snapshot:", snapshot.label);
    return NextResponse.json({ success: true, deletedLabel: snapshot.label });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[plan/history/id] Delete error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
