import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requirePlanEditor } from "@/lib/require-plan-editor";

/**
 * GET    /api/plan/year?year=YYYY — what deleting that year would remove.
 * DELETE /api/plan/year?year=YYYY — remove the plan year entirely.
 *
 * DISTINCT FROM /api/plan/reset. Reset empties a year and leaves the
 * `annual_plans` row behind with zeroed targets, so the year stays in the
 * picker as a $0 draft. This removes the row as well, so the year disappears.
 *
 * The year picker is NOT driven by `annual_plans` — `usePlanYears` derives it
 * from initiative activation and event dates. So a year only vanishes once its
 * initiatives are gone, which is why this deletes both. The current calendar
 * year is always unioned in by that hook and will keep appearing as an empty
 * year; the GET response says so via `reappears` rather than letting the user
 * find out afterwards.
 *
 * GET exists so the confirmation dialog can name real counts. A dialog that
 * says "this cannot be undone" without saying what goes is not informed
 * consent, and logged RESULTS are the part worth hesitating over — those are
 * actual recorded revenue, not plan scaffolding that can be regenerated.
 */

/** Resolve the caller, their company, and a Supabase client. */
async function resolveCaller() {
  const check = await requirePlanEditor();
  if (!check.ok) {
    return {
      error: NextResponse.json({ error: check.error }, { status: check.status }),
    };
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  return { supabase, companyId: check.companyId, userId: check.userId };
}

/** The year from the query string, or null when absent or implausible. */
function targetYear(request: Request): number | null {
  const raw = Number(new URL(request.url).searchParams.get("year"));
  return Number.isInteger(raw) && raw > 2000 && raw < 2200 ? raw : null;
}

/**
 * Everything attached to a plan year.
 *
 * Initiatives are matched BOTH by `annual_plan_id` and by date range. A
 * 12-month plan starting in September spills into the next calendar year, and
 * those later initiatives still belong to the earlier plan row — so deleting
 * "2027" has to catch initiatives dated in 2027 that hang off the 2026 plan,
 * or they would survive and keep 2027 in the picker.
 */
async function collectYear(
  supabase: Awaited<ReturnType<typeof resolveCaller>>["supabase"],
  companyId: string,
  year: number
) {
  if (!supabase) return null;

  const { data: plan } = await supabase
    .from("annual_plans")
    .select("id, year, baseline_revenue, stretch_revenue")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // Dated into this calendar year, whichever plan row they belong to.
  const { data: byDate } = await supabase
    .from("initiatives")
    .select("id, name, annual_plan_id, activation_date, event_date")
    .eq("company_id", companyId)
    .or(
      `and(activation_date.gte.${start},activation_date.lte.${end}),` +
        `and(event_date.gte.${start},event_date.lte.${end})`
    );

  // Belonging to this year's plan row, whatever their dates.
  const { data: byPlan } = plan?.id
    ? await supabase
        .from("initiatives")
        .select("id, name, annual_plan_id, activation_date, event_date")
        .eq("company_id", companyId)
        .eq("annual_plan_id", plan.id)
    : { data: [] as Record<string, unknown>[] };

  const byId = new Map<string, Record<string, unknown>>();
  for (const row of [...(byDate ?? []), ...(byPlan ?? [])]) {
    byId.set(row.id as string, row as Record<string, unknown>);
  }

  const initiativeIds = [...byId.keys()];

  const [{ count: taskCount }, { count: resultCount }, { count: expenseCount }] =
    initiativeIds.length > 0
      ? await Promise.all([
          supabase
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .in("initiative_id", initiativeIds),
          supabase
            .from("results")
            .select("id", { count: "exact", head: true })
            .in("initiative_id", initiativeIds),
          supabase
            .from("expenses")
            .select("id", { count: "exact", head: true })
            .in("initiative_id", initiativeIds),
        ])
      : [{ count: 0 }, { count: 0 }, { count: 0 }];

  return {
    plan: plan ?? null,
    initiativeIds,
    initiatives: [...byId.values()],
    taskCount: taskCount ?? 0,
    resultCount: resultCount ?? 0,
    expenseCount: expenseCount ?? 0,
  };
}

export async function GET(request: Request) {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { supabase, companyId } = caller;

    const year = targetYear(request);
    if (year === null) {
      return NextResponse.json({ error: "A valid ?year= is required." }, { status: 400 });
    }

    const found = await collectYear(supabase, companyId!, year);
    if (!found) {
      return NextResponse.json({ error: "Could not read that year." }, { status: 500 });
    }

    const currentYear = new Date().getFullYear();

    return NextResponse.json({
      year,
      exists: Boolean(found.plan) || found.initiativeIds.length > 0,
      initiativeCount: found.initiativeIds.length,
      initiativeNames: found.initiatives
        .map((i) => i.name as string)
        .filter(Boolean)
        .slice(0, 5),
      taskCount: found.taskCount,
      // The figure that should give someone pause: recorded actuals.
      resultCount: found.resultCount,
      expenseCount: found.expenseCount,
      /**
       * The current year is always offered by `usePlanYears`, so deleting it
       * empties it rather than removing it. Said up front so the dialog can be
       * honest instead of appearing not to have worked.
       */
      reappears: year === currentYear,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plan/year] GET failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { supabase, companyId, userId } = caller;

    const year = targetYear(request);
    if (year === null) {
      return NextResponse.json({ error: "A valid ?year= is required." }, { status: 400 });
    }

    console.log("[plan/year] Deleting", year, "for company", companyId, "user", userId);

    const found = await collectYear(supabase, companyId!, year);
    if (!found) {
      return NextResponse.json({ error: "Could not read that year." }, { status: 500 });
    }

    if (!found.plan && found.initiativeIds.length === 0) {
      // Already gone. Not an error — the outcome the caller wanted holds.
      return NextResponse.json({ success: true, deleted: 0, snapshotId: null });
    }

    /**
     * Snapshot BEFORE deleting, and abort if it fails.
     *
     * Same rule as `/api/plan/reset`: the snapshot is the only way back, so
     * proceeding without one would make this genuinely irreversible. With it,
     * the dialog's "this cannot be undone" is softened by Plan History.
     */
    let snapshotId: string | null = null;

    const [{ data: initiatives }, { data: tasks }, { data: projections },
           { data: results }, { data: expenses }] = await Promise.all([
      found.initiativeIds.length
        ? supabase!.from("initiatives").select("*").in("id", found.initiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      found.initiativeIds.length
        ? supabase!.from("tasks").select("*").in("initiative_id", found.initiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      found.plan?.id
        ? supabase!.from("projections").select("*").eq("annual_plan_id", found.plan.id)
        : Promise.resolve({ data: [] as unknown[] }),
      found.initiativeIds.length
        ? supabase!.from("results").select("*").in("initiative_id", found.initiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
      found.initiativeIds.length
        ? supabase!.from("expenses").select("*").in("initiative_id", found.initiativeIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const { data: planRow } = found.plan?.id
      ? await supabase!.from("annual_plans").select("*").eq("id", found.plan.id).maybeSingle()
      : { data: null };

    const { count: snapshotCount } = await supabase!
      .from("plan_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId!);

    const label = `${year} Plan (deleted) v${(snapshotCount || 0) + 1}`;

    const { data: snapRow, error: snapErr } = await supabase!
      .from("plan_snapshots")
      .insert({
        company_id: companyId,
        label,
        snapshot: {
          annualPlan: planRow,
          initiatives: initiatives ?? [],
          tasks: tasks ?? [],
          projections: projections ?? [],
          results: results ?? [],
          expenses: expenses ?? [],
          deletedYear: year,
          snapshotDate: new Date().toISOString(),
        },
      })
      .select("id")
      .single();

    if (snapErr || !snapRow) {
      console.error("[plan/year] Snapshot FAILED — aborting delete:", snapErr?.message);
      return NextResponse.json(
        { error: "Could not back up this year before deleting, so nothing was removed." },
        { status: 500 }
      );
    }

    snapshotId = snapRow.id as string;

    /**
     * Delete children before parents.
     *
     * `tasks`, `results` and `expenses` reference initiatives; `projections`
     * and `initiatives` reference the plan row. Most of these cascade, but
     * they are removed explicitly so a missing cascade cannot leave orphans
     * pointing at a deleted plan.
     */
    if (found.initiativeIds.length > 0) {
      for (const table of ["tasks", "results", "expenses"] as const) {
        const { error } = await supabase!
          .from(table)
          .delete()
          .in("initiative_id", found.initiativeIds);
        if (error) {
          console.error(`[plan/year] ${table} delete failed:`, error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }

    if (found.plan?.id) {
      const { error } = await supabase!
        .from("projections")
        .delete()
        .eq("annual_plan_id", found.plan.id);
      if (error) {
        console.error("[plan/year] projections delete failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (found.initiativeIds.length > 0) {
      const { error } = await supabase!
        .from("initiatives")
        .delete()
        .in("id", found.initiativeIds);
      if (error) {
        console.error("[plan/year] initiatives delete failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    /**
     * The plan row last, and ONLY once its children are gone.
     *
     * Scoped by company_id as well as id: the id came from a company-filtered
     * read, and keeping the filter means a future refactor cannot turn this
     * into a cross-tenant delete.
     */
    if (found.plan?.id) {
      const { error } = await supabase!
        .from("annual_plans")
        .delete()
        .eq("id", found.plan.id)
        .eq("company_id", companyId!);
      if (error) {
        console.error("[plan/year] annual plan delete failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    console.log(
      "[plan/year] Deleted", year,
      "| initiatives:", found.initiativeIds.length,
      "| snapshot:", label
    );

    return NextResponse.json({
      success: true,
      year,
      deleted: found.initiativeIds.length,
      snapshotId,
      snapshotLabel: label,
      reappears: year === new Date().getFullYear(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[plan/year] DELETE failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
