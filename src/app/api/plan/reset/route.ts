import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * DELETE /api/plan/reset
 *
 * Resets the user's plan data for regeneration.
 * Deletes: initiatives, tasks, projections, results, expenses
 * Keeps: products, company, profile, planning_inputs
 * Resets: annual_plan revenue fields to 0
 */
export async function DELETE() {
  try {
    console.log("[plan/reset] Starting plan reset...");

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
      console.log("[plan/reset] No user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      console.log("[plan/reset] No company for user:", user.email);
      return NextResponse.json({ error: "No company found" }, { status: 400 });
    }

    const companyId = profile.company_id;
    console.log("[plan/reset] Company:", companyId, "| User:", user.email);

    // 3. Snapshot current plan before deleting
    console.log("[plan/reset] Creating snapshot of current plan...");
    try {
      const [
        { data: initiatives },
        { data: tasks },
        { data: projections },
        { data: results },
        { data: expenses },
        { data: annualPlan },
      ] = await Promise.all([
        supabase.from("initiatives").select("*").eq("company_id", companyId),
        supabase.from("tasks").select("*").eq("company_id", companyId),
        supabase.from("projections").select("*").eq("company_id", companyId),
        supabase.from("results").select("*").eq("company_id", companyId),
        supabase.from("expenses").select("*").eq("company_id", companyId),
        supabase.from("annual_plans").select("*").eq("company_id", companyId).order("year", { ascending: false }).limit(1).single(),
      ]);

      const hasData = (initiatives?.length || 0) + (tasks?.length || 0) + (projections?.length || 0) > 0;

      if (hasData) {
        // Count existing snapshots for labeling
        const { count } = await supabase
          .from("plan_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);

        const version = (count || 0) + 1;
        const label = `Plan v${version}`;

        const snapshot = {
          annualPlan: annualPlan || null,
          initiatives: initiatives || [],
          tasks: tasks || [],
          projections: projections || [],
          results: results || [],
          expenses: expenses || [],
          snapshotDate: new Date().toISOString(),
        };

        const { error: snapErr } = await supabase
          .from("plan_snapshots")
          .insert({ company_id: companyId, label, snapshot });

        if (snapErr) {
          console.error("[plan/reset] Snapshot save failed:", snapErr.message);
          // Non-fatal: continue with reset even if snapshot fails
        } else {
          console.log("[plan/reset] Snapshot saved as:", label, "| initiatives:", initiatives?.length, "tasks:", tasks?.length);
        }
      } else {
        console.log("[plan/reset] No existing data to snapshot, skipping");
      }
    } catch (snapErr) {
      console.error("[plan/reset] Snapshot error (non-fatal):", snapErr);
    }

    // 4. Delete in dependency order (children first)
    const { error: tasksErr } = await supabase.from("tasks").delete().eq("company_id", companyId);
    console.log("[plan/reset] Deleted tasks:", tasksErr ? "ERROR: " + tasksErr.message : "ok");

    const { error: resultsErr } = await supabase.from("results").delete().eq("company_id", companyId);
    console.log("[plan/reset] Deleted results:", resultsErr ? "ERROR: " + resultsErr.message : "ok");

    const { error: expensesErr } = await supabase.from("expenses").delete().eq("company_id", companyId);
    console.log("[plan/reset] Deleted expenses:", expensesErr ? "ERROR: " + expensesErr.message : "ok");

    const { error: projErr } = await supabase.from("projections").delete().eq("company_id", companyId);
    console.log("[plan/reset] Deleted projections:", projErr ? "ERROR: " + projErr.message : "ok");

    const { error: initErr } = await supabase.from("initiatives").delete().eq("company_id", companyId);
    console.log("[plan/reset] Deleted initiatives:", initErr ? "ERROR: " + initErr.message : "ok");

    // Reset annual plan
    const { error: planErr } = await supabase
      .from("annual_plans")
      .update({ baseline_revenue: 0, stretch_revenue: 0, operating_budget: 0, status: "draft" })
      .eq("company_id", companyId);
    console.log("[plan/reset] Reset annual plan:", planErr ? "ERROR: " + planErr.message : "ok");

    // Reset company targets
    const { error: compErr } = await supabase
      .from("companies")
      .update({ target_revenue: 0, baseline_revenue: 0, stretch_revenue: 0, operating_budget: 0 })
      .eq("id", companyId);
    console.log("[plan/reset] Reset company:", compErr ? "ERROR: " + compErr.message : "ok");

    const errors = [tasksErr, resultsErr, expensesErr, projErr, initErr, planErr, compErr].filter(Boolean);
    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors.map(e => e!.message).join(", ") }, { status: 207 });
    }

    console.log("[plan/reset] Complete");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[plan/reset] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
