import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * DELETE /api/plan/reset?year=YYYY
 *
 * Resets ONE year's plan data for regeneration.
 * Deletes: initiatives, tasks, projections, results, expenses for that year
 * Keeps: products, company, profile, planning_inputs, and every OTHER year
 * Resets: that year's annual_plan revenue fields to 0
 *
 * Year scoping matters: this used to delete by company_id alone, so generating
 * a plan for a future year wiped the current year's plan as collateral damage
 * and the dashboard fell back to its empty state.
 */
export async function DELETE(request: Request) {
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

    // Which year are we resetting? Defaults to the newest plan (previous
    // behaviour) when the caller does not say.
    const url = new URL(request.url);
    const yearParam = Number(url.searchParams.get("year"));
    const targetYear = Number.isFinite(yearParam) && yearParam > 2000 ? yearParam : null;

    const { data: targetPlan } = targetYear
      ? await supabase
          .from("annual_plans")
          .select("id, year")
          .eq("company_id", companyId)
          .eq("year", targetYear)
          .maybeSingle()
      : await supabase
          .from("annual_plans")
          .select("id, year")
          .eq("company_id", companyId)
          .order("year", { ascending: false })
          .limit(1)
          .maybeSingle();

    if (!targetPlan?.id) {
      // Nothing to reset for that year - not an error, just a no-op.
      console.log("[plan/reset] No plan row for year", targetYear ?? "(latest)", "- nothing to reset");
      return NextResponse.json({ success: true, snapshotId: null, snapshotLabel: null, reset: 0 });
    }

    const planId = targetPlan.id;
    console.log("[plan/reset] Company:", companyId, "| User:", user.email, "| year:", targetPlan.year, "| planId:", planId);

    // Initiatives belonging to THIS year - used to scope task/result/expense deletes.
    const { data: yearInitiatives } = await supabase
      .from("initiatives")
      .select("id")
      .eq("annual_plan_id", planId);
    const yearInitiativeIds = (yearInitiatives || []).map((i) => i.id);

    // 3. Snapshot current plan before deleting.
    //    The snapshot is the rollback mechanism for a failed regeneration, so
    //    a failed snapshot write MUST abort the reset (clause 2.4). We also
    //    return the snapshot id/label so the client can auto-restore it if
    //    generation fails afterwards (clause 2.5).
    console.log("[plan/reset] Creating snapshot of current plan...");
    let snapshotId: string | null = null;
    let snapshotLabel: string | null = null;

    const [
      { data: initiatives },
      { data: tasks },
      { data: projections },
      { data: results },
      { data: expenses },
      { data: annualPlan },
    ] = await Promise.all([
      supabase.from("initiatives").select("*").eq("annual_plan_id", planId),
      yearInitiativeIds.length
        ? supabase.from("tasks").select("*").in("initiative_id", yearInitiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase.from("projections").select("*").eq("annual_plan_id", planId),
      yearInitiativeIds.length
        ? supabase.from("results").select("*").in("initiative_id", yearInitiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      yearInitiativeIds.length
        ? supabase.from("expenses").select("*").in("initiative_id", yearInitiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase.from("annual_plans").select("*").eq("id", planId).single(),
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

      const { data: snapRow, error: snapErr } = await supabase
        .from("plan_snapshots")
        .insert({ company_id: companyId, label, snapshot })
        .select("id")
        .single();

      if (snapErr || !snapRow) {
        // FATAL: without a snapshot there is no rollback, so we must not delete.
        console.error("[plan/reset] Snapshot save FAILED — aborting reset:", snapErr?.message);
        return NextResponse.json(
          { error: "Could not snapshot the current plan; reset aborted to avoid data loss." },
          { status: 500 }
        );
      }

      snapshotId = snapRow.id;
      snapshotLabel = label;
      console.log("[plan/reset] Snapshot saved as:", label, "id:", snapshotId, "| initiatives:", initiatives?.length, "tasks:", tasks?.length);
    } else {
      console.log("[plan/reset] No existing data to snapshot, skipping");
    }

    // 4. Delete in dependency order (children first)
    const noInits = yearInitiativeIds.length === 0;
    const { error: tasksErr } = noInits
      ? { error: null }
      : await supabase.from("tasks").delete().in("initiative_id", yearInitiativeIds);
    console.log("[plan/reset] Deleted tasks:", tasksErr ? "ERROR: " + tasksErr.message : "ok");

    const { error: resultsErr } = noInits
      ? { error: null }
      : await supabase.from("results").delete().in("initiative_id", yearInitiativeIds);
    console.log("[plan/reset] Deleted results:", resultsErr ? "ERROR: " + resultsErr.message : "ok");

    const { error: expensesErr } = noInits
      ? { error: null }
      : await supabase.from("expenses").delete().in("initiative_id", yearInitiativeIds);
    console.log("[plan/reset] Deleted expenses:", expensesErr ? "ERROR: " + expensesErr.message : "ok");

    const { error: projErr } = await supabase.from("projections").delete().eq("annual_plan_id", planId);
    console.log("[plan/reset] Deleted projections:", projErr ? "ERROR: " + projErr.message : "ok");

    const { error: initErr } = await supabase.from("initiatives").delete().eq("annual_plan_id", planId);
    console.log("[plan/reset] Deleted initiatives:", initErr ? "ERROR: " + initErr.message : "ok");

    // Reset annual plan
    const { error: planErr } = await supabase
      .from("annual_plans")
      .update({ baseline_revenue: 0, stretch_revenue: 0, operating_budget: 0, status: "draft" })
      .eq("id", planId);
    console.log("[plan/reset] Reset annual plan:", planErr ? "ERROR: " + planErr.message : "ok");

    // Reset the company mirror ONLY when resetting the current year. The
    // companies table holds a single set of revenue figures, so zeroing it
    // while planning a future year would blank the current year's headline
    // numbers.
    const isCurrentYear = targetPlan.year === new Date().getFullYear();
    let compErr: { message: string } | null = null;
    if (isCurrentYear) {
      const res = await supabase
        .from("companies")
        .update({ target_revenue: 0, baseline_revenue: 0, stretch_revenue: 0, operating_budget: 0 })
        .eq("id", companyId);
      compErr = res.error;
      console.log("[plan/reset] Reset company mirror:", compErr ? "ERROR: " + compErr.message : "ok");
    } else {
      console.log("[plan/reset] Skipped company mirror (not the current year)");
    }

    const errors = [tasksErr, resultsErr, expensesErr, projErr, initErr, planErr, compErr].filter(Boolean);
    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors.map(e => e!.message).join(", "), snapshotId, snapshotLabel }, { status: 207 });
    }

    console.log("[plan/reset] Complete");
    return NextResponse.json({ success: true, snapshotId, snapshotLabel });
  } catch (err: any) {
    console.error("[plan/reset] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
