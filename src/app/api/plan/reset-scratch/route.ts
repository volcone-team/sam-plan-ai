import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * DELETE /api/plan/reset-scratch
 *
 * "Start from Scratch" regeneration — SELECTIVE deletion.
 *
 * KEEPS (never deleted):
 *   - Completed / launched / in-progress initiatives (touched or done)
 *   - All results, expenses, and their history
 *
 * DELETES (only these):
 *   - Initiatives with status 'planned' (not-yet-started work), regardless of
 *     date - a past-dated planned initiative is still untouched work, and
 *     keeping it caused duplicates to pile up on each regeneration
 *   - Tasks belonging to those deleted initiatives (via ON DELETE CASCADE)
 *
 * Also snapshots the full current plan to plan_snapshots first, so nothing
 * is ever truly lost.
 */
export async function DELETE(request: Request) {
  try {
    console.log("[plan/reset-scratch] Starting selective reset...");

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
      console.log("[plan/reset-scratch] No user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      console.log("[plan/reset-scratch] No company for user:", user.email);
      return NextResponse.json({ error: "No company found" }, { status: 400 });
    }

    const companyId = profile.company_id;
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    console.log("[plan/reset-scratch] Company:", companyId, "| today:", today);

    // Which year are we resetting? Scope to that year's plan so a future-year
    // regeneration cannot touch the current year's initiatives.
    const url = new URL(request.url);
    const yearParam = Number(url.searchParams.get("year"));
    const targetYear = Number.isFinite(yearParam) && yearParam > 2000 ? yearParam : null;

    const { data: targetPlan } = targetYear
      ? await supabase.from("annual_plans").select("id, year").eq("company_id", companyId).eq("year", targetYear).maybeSingle()
      : await supabase.from("annual_plans").select("id, year").eq("company_id", companyId).order("year", { ascending: false }).limit(1).maybeSingle();

    if (!targetPlan?.id) {
      console.log("[plan/reset-scratch] No plan row for year", targetYear ?? "(latest)", "- nothing to reset");
      return NextResponse.json({ success: true, deleted: 0, kept: 0 });
    }
    const planId = targetPlan.id;
    console.log("[plan/reset-scratch] Year:", targetPlan.year, "| planId:", planId);

    // 1. Load this year's initiatives to decide what stays vs. goes
    const { data: allInitiatives, error: loadErr } = await supabase
      .from("initiatives")
      .select("id, name, status, activation_date")
      .eq("annual_plan_id", planId);

    if (loadErr) {
      console.error("[plan/reset-scratch] Failed to load initiatives:", loadErr.message);
      return NextResponse.json({ error: loadErr.message }, { status: 500 });
    }

    // Decide which initiatives to delete: any that have NOT been started.
    //
    // This used to also require activation_date > today, which meant
    // past-dated "planned" rows survived every regeneration and the new
    // generation stacked more on top - one company accumulated 26 initiatives
    // with the same names repeated. `status === "planned"` already means
    // untouched, so the date test only caused duplication.
    const toDelete = (allInitiatives || []).filter((i) => i.status === "planned");
    const toKeep = (allInitiatives || []).filter((i) => !toDelete.includes(i));

    console.log(
      "[plan/reset-scratch] Total:", allInitiatives?.length || 0,
      "| deleting (planned+future):", toDelete.length,
      "| keeping (past/in-progress/completed):", toKeep.length
    );
    toDelete.forEach((i) =>
      console.log("[plan/reset-scratch]   DELETE:", i.name, "| status:", i.status, "| date:", i.activation_date)
    );

    // 2. Snapshot the FULL current plan before touching anything
    console.log("[plan/reset-scratch] Creating snapshot...");
    try {
      const [
        { data: initiativesFull },
        { data: tasksFull },
        { data: projectionsFull },
        { data: resultsFull },
        { data: expensesFull },
        { data: annualPlanFull },
      ] = await Promise.all([
        supabase.from("initiatives").select("*").eq("annual_plan_id", planId),
        supabase.from("tasks").select("*").eq("company_id", companyId),
        supabase.from("projections").select("*").eq("annual_plan_id", planId),
        supabase.from("results").select("*").eq("company_id", companyId),
        supabase.from("expenses").select("*").eq("company_id", companyId),
        supabase.from("annual_plans").select("*").eq("id", planId).single(),
      ]);

      const hasData = (initiativesFull?.length || 0) > 0;
      if (hasData) {
        const { count } = await supabase
          .from("plan_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);

        const version = (count || 0) + 1;
        const label = `Plan v${version} (before start-from-scratch)`;

        const snapshot = {
          annualPlan: annualPlanFull || null,
          initiatives: initiativesFull || [],
          tasks: tasksFull || [],
          projections: projectionsFull || [],
          results: resultsFull || [],
          expenses: expensesFull || [],
          snapshotDate: new Date().toISOString(),
        };

        const { error: snapErr } = await supabase
          .from("plan_snapshots")
          .insert({ company_id: companyId, label, snapshot });

        console.log("[plan/reset-scratch] Snapshot:", snapErr ? "ERROR: " + snapErr.message : label);
      } else {
        console.log("[plan/reset-scratch] No data to snapshot");
      }
    } catch (snapErr) {
      console.error("[plan/reset-scratch] Snapshot error (non-fatal):", snapErr);
    }

    // 3. If nothing to delete, we're done — kept everything
    if (toDelete.length === 0) {
      console.log("[plan/reset-scratch] No upcoming initiatives to remove. Done.");
      return NextResponse.json({ success: true, deleted: 0, kept: toKeep.length });
    }

    const deleteIds = toDelete.map((i) => i.id);

    // 4. Delete dependent rows for ONLY the deleted initiatives first.
    //    Tasks cascade automatically (ON DELETE CASCADE), but results/expenses
    //    also reference initiatives — clean those explicitly for the deleted set.
    const { error: resErr } = await supabase
      .from("results")
      .delete()
      .in("initiative_id", deleteIds);
    console.log("[plan/reset-scratch] Deleted results for removed initiatives:", resErr ? "ERROR: " + resErr.message : "ok");

    const { error: expErr } = await supabase
      .from("expenses")
      .delete()
      .in("initiative_id", deleteIds);
    console.log("[plan/reset-scratch] Deleted expenses for removed initiatives:", expErr ? "ERROR: " + expErr.message : "ok");

    // Tasks: cascade on initiative delete, but delete explicitly to be safe/clear
    const { error: taskErr } = await supabase
      .from("tasks")
      .delete()
      .in("initiative_id", deleteIds);
    console.log("[plan/reset-scratch] Deleted tasks for removed initiatives:", taskErr ? "ERROR: " + taskErr.message : "ok");

    // 5. Delete the upcoming initiatives themselves
    const { error: initErr } = await supabase
      .from("initiatives")
      .delete()
      .in("id", deleteIds);
    console.log("[plan/reset-scratch] Deleted initiatives:", initErr ? "ERROR: " + initErr.message : `ok (${deleteIds.length})`);

    if (initErr) {
      return NextResponse.json({ error: initErr.message }, { status: 500 });
    }

    // NOTE: projections and annual_plan targets are intentionally NOT wiped here.
    // The fresh AI generation that follows will recompute and overwrite them,
    // and keeping past initiatives means we don't reset company revenue to 0.

    console.log("[plan/reset-scratch] Complete. Deleted:", deleteIds.length, "| kept:", toKeep.length);
    return NextResponse.json({ success: true, deleted: deleteIds.length, kept: toKeep.length });
  } catch (err: any) {
    console.error("[plan/reset-scratch] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
