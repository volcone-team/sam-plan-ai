import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { snapshotPlanYear, snapshotPlanTargets } from "@/lib/plan-snapshot-year";
import { snapshotProducts } from "@/lib/snapshot-products";

/**
 * POST /api/plan/history/[id]/restore
 *
 * Restores a past plan snapshot as the ACTIVE plan.
 *
 *   ?initiativeId=<uuid>  -> restore only that ONE initiative from the snapshot
 *   (no param)            -> restore the ENTIRE plan
 *
 * Before restoring, the CURRENT plan is snapshotted so nothing is lost.
 * Restore = re-insert the snapshot's initiatives (and their tasks) as new,
 * active rows attached to the company's current annual plan. Products are
 * matched by name; missing products are recreated so initiative FKs resolve.
 *
 * Full restore additionally clears the current upcoming (not-started) plan so
 * the restored plan replaces it, keeping completed/in-progress work intact.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const onlyInitiativeId = searchParams.get("initiativeId");

    console.log("[plan/restore] snapshot:", id, onlyInitiativeId ? `| single initiative: ${onlyInitiativeId}` : "| full plan");

    // Auth
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
      return NextResponse.json({ error: "Your role cannot restore plans." }, { status: 403 });
    }

    const companyId = profile.company_id;
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Load the snapshot
    const { data: snap, error: snapErr } = await admin
      .from("plan_snapshots")
      .select("*")
      .eq("id", id)
      .single();

    if (snapErr || !snap) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    if (snap.company_id !== companyId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data = (snap.snapshot as any) || {};
    const snapInitiatives: any[] = data.initiatives || [];
    const snapTasks: any[] = data.tasks || [];

    /**
     * AN EMPTY PLAN IS STILL A PLAN WORTH RESTORING.
     *
     * This used to refuse any snapshot with no initiatives. But deleting a
     * plan year captures exactly that: a snapshot holding the year and its
     * revenue targets with nothing in it. Restoring it recreates the year with
     * its goals — an empty dashboard the customer can start filling again,
     * which is the whole reason they clicked restore.
     *
     * Refused only when there is genuinely NOTHING to put back: no
     * initiatives and no plan record either.
     */
    if (snapInitiatives.length === 0 && !data.annualPlan) {
      return NextResponse.json(
        { error: "This snapshot is empty — there is nothing to restore from it." },
        { status: 400 }
      );
    }

    // 2. Snapshot the CURRENT plan first (so restore is itself reversible)
    try {
      const [
        { data: curInit },
        { data: curTasks },
        { data: curProj },
        { data: curResults },
        { data: curExpenses },
        { data: curAnnual },
      ] = await Promise.all([
        admin.from("initiatives").select("*").eq("company_id", companyId),
        admin.from("tasks").select("*").eq("company_id", companyId),
        admin.from("projections").select("*").eq("company_id", companyId),
        admin.from("results").select("*").eq("company_id", companyId),
        admin.from("expenses").select("*").eq("company_id", companyId),
        admin.from("annual_plans").select("*").eq("company_id", companyId).order("year", { ascending: false }).limit(1).single(),
      ]);

      if ((curInit?.length || 0) > 0) {
        const { count } = await admin
          .from("plan_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        await admin.from("plan_snapshots").insert({
          company_id: companyId,
          label: `Plan v${(count || 0) + 1} (before restore)`,
          snapshot: {
            annualPlan: curAnnual || null,
            initiatives: curInit || [],
            tasks: curTasks || [],
            projections: curProj || [],
            results: curResults || [],
            expenses: curExpenses || [],
            // Products are needed to restore initiatives (product_id is NOT NULL).
            products: await snapshotProducts(admin, companyId),
            snapshotDate: new Date().toISOString(),
          },
        });
        console.log("[plan/restore] Snapshotted current plan before restore");
      }
    } catch (e) {
      console.error("[plan/restore] Pre-restore snapshot failed (non-fatal):", e);
    }

    /**
     * 3. Resolve the plan row to restore INTO — by the snapshot's own year,
     *    creating it if the year no longer exists.
     *
     * This used to take the company's most recent `annual_plans` row and
     * refuse outright when there wasn't one. Both halves were wrong:
     *
     *   - "No active annual plan to restore into" is exactly the state someone
     *     restoring from history is usually in. They deleted the plan; getting
     *     it back is the entire point of the feature. The snapshot already
     *     carries its own `annualPlan`, so the year can simply be rebuilt.
     *
     *   - Picking the LATEST year filed a 2026 snapshot's initiatives under a
     *     2027 plan whenever one existed, silently relocating a year of work.
     *
     * `snapshotPlanYear` answers this from the snapshot rather than from
     * whatever the database holds now.
     */
    const targetYear = snapshotPlanYear(data, new Date().getUTCFullYear());

    const { data: existingPlan } = await admin
      .from("annual_plans")
      .select("id")
      .eq("company_id", companyId)
      .eq("year", targetYear)
      .maybeSingle();

    let annualPlan = existingPlan as { id: string } | null;

    if (!annualPlan) {
      /**
       * Recreate the year, with the snapshot's own targets.
       *
       * `status: "active"` because a restored plan is one the customer intends
       * to run — leaving it 'draft' would hide it from the views that filter on
       * active plans, so the restore would appear to have done nothing.
       */
      const { data: createdPlan, error: createPlanErr } = await admin
        .from("annual_plans")
        .insert({
          company_id: companyId,
          year: targetYear,
          ...snapshotPlanTargets(data),
          status: "active",
        })
        .select("id")
        .single();

      if (createPlanErr || !createdPlan) {
        console.error(
          "[plan/restore] Could not recreate the", targetYear, "plan:",
          createPlanErr?.message
        );
        return NextResponse.json(
          {
            error:
              `Could not recreate your ${targetYear} plan, so nothing was ` +
              `restored. Please try again.`,
          },
          { status: 500 }
        );
      }

      annualPlan = createdPlan as { id: string };
      console.log("[plan/restore] Recreated the", targetYear, "plan to restore into");
    }

    // 4. Build a product-id map. Snapshot initiatives reference old product ids.
    //    Match current products by name; if missing, recreate from snapshot products.
    //
    //    Matching is NORMALISED (trim + lowercase) to agree with the generator
    //    in /api/generate-plan. It used to compare raw names, so any difference
    //    in case or surrounding whitespace missed the match and recreated the
    //    product - leaving the company with two rows of the same name, the
    //    original empty and the new copy holding the restored initiatives.
    //    That is the reported "products are duplicated" defect: a failed
    //    generation triggers a rollback, the rollback restores, and the restore
    //    duplicated every product whose name did not match byte-for-byte.
    const productKey = (name: unknown) => String(name ?? "").trim().toLowerCase();

    const { data: currentProducts } = await admin
      .from("products")
      .select("id, name")
      .eq("company_id", companyId);
    const productByName = new Map(
      (currentProducts || []).map((p) => [productKey(p.name), p.id])
    );

    // Map: snapshot product_id -> live product_id
    const snapProducts: any[] = data.products || [];
    const productIdMap = new Map<string, string>();
    for (const sp of snapProducts) {
      let liveId = productByName.get(productKey(sp.name));
      if (!liveId) {
        const { data: recreated } = await admin
          .from("products")
          .insert({
            company_id: companyId,
            name: sp.name || "Restored Product",
            description: sp.description || "",
            price: sp.price || 0,
            revenue_type: sp.revenue_type || "one-time",
            ticket_tier: sp.ticket_tier || "mid",
            is_active: true,
            display_order: sp.display_order || 0,
          })
          .select("id")
          .single();
        liveId = recreated?.id;
        if (liveId) productByName.set(productKey(sp.name), liveId);
      }
      if (liveId) productIdMap.set(sp.id, liveId);
    }
    // Fallback product for initiatives whose product can't be mapped
    let fallbackProductId: string | undefined =
      (currentProducts || [])[0]?.id || Array.from(productIdMap.values())[0];

    /**
     * NO PRODUCTS ANYWHERE — create one so the initiatives can come back.
     *
     * Snapshots written before products were included carry none, and if the
     * customer has also deleted their products there is nothing to attach the
     * initiatives to. `initiatives.product_id` is NOT NULL, so every one used
     * to be skipped while the screen still reported "Plan restored — 0
     * initiative(s) added".
     *
     * One placeholder is better than losing the plan. It is named plainly so
     * the customer knows to rename it, and only created when there are
     * initiatives that actually need it.
     */
    const needsProduct = (onlyInitiativeId
      ? snapInitiatives.filter((i) => i.id === onlyInitiativeId)
      : snapInitiatives
    ).some((i) => !productIdMap.get(i.product_id));

    if (!fallbackProductId && needsProduct) {
      const { data: placeholder, error: placeholderErr } = await admin
        .from("products")
        .insert({
          company_id: companyId,
          name: "Restored product (rename me)",
          description: "Created when restoring a plan whose products had been deleted.",
          price: 0,
          revenue_type: "one-time",
          ticket_tier: "mid",
          is_active: true,
          display_order: 0,
        })
        .select("id")
        .single();

      if (placeholderErr || !placeholder) {
        console.error("[plan/restore] Could not create a placeholder product:", placeholderErr?.message);
        return NextResponse.json(
          { error: "Could not restore: your products were deleted and a replacement could not be created." },
          { status: 500 }
        );
      }
      fallbackProductId = placeholder.id as string;
      console.log("[plan/restore] Created a placeholder product to restore into");
    }

    // 5. Which snapshot initiatives to restore
    const initiativesToRestore = onlyInitiativeId
      ? snapInitiatives.filter((i) => i.id === onlyInitiativeId)
      : snapInitiatives;

    // Only meaningful for a SINGLE-initiative restore. A full restore of an
    // empty plan (a deleted year with no initiatives) is legitimate and must
    // fall through to restoring the year and its targets.
    if (onlyInitiativeId && initiativesToRestore.length === 0) {
      return NextResponse.json({ error: "That initiative was not found in the snapshot." }, { status: 404 });
    }

    // 6. FULL restore only: clear current upcoming (not-started, future) initiatives
    //    so the restored plan replaces the upcoming plan. Keep past/in-progress.
    if (!onlyInitiativeId) {
      // Clear every initiative that has not been started, regardless of date.
      // Filtering by future activation_date left past-dated "planned" rows in
      // place, so repeated restores accumulated duplicates.
      const { data: current } = await admin
        .from("initiatives")
        .select("id, status")
        .eq("company_id", companyId);
      const clearIds = (current || [])
        .filter((i) => i.status === "planned")
        .map((i) => i.id);
      if (clearIds.length > 0) {
        await admin.from("tasks").delete().in("initiative_id", clearIds);
        await admin.from("initiatives").delete().in("id", clearIds);
        console.log("[plan/restore] Cleared", clearIds.length, "not-started initiatives before full restore");
      }
    }

    // 7. Re-insert snapshot initiatives (+ their tasks) as new rows
    let restoredCount = 0;
    for (const si of initiativesToRestore) {
      const productId = productIdMap.get(si.product_id) || fallbackProductId;
      if (!productId) {
        console.warn("[plan/restore] Skipping initiative (no product):", si.name);
        continue;
      }

      const { data: newInit, error: insErr } = await admin
        .from("initiatives")
        .insert({
          company_id: companyId,
          annual_plan_id: annualPlan.id,
          product_id: productId,
          initiative_type_id: si.initiative_type_id,
          name: si.name,
          description: si.description || "",
          kind: si.kind || "one-time",
          status: "planned", // restored as fresh/planned
          activation_date: si.activation_date,
          event_date: si.event_date,
          traffic_input: si.traffic_input ?? null,
          revenue_good: si.revenue_good || 0,
          revenue_better: si.revenue_better || 0,
          revenue_best: si.revenue_best || 0,
          planned_budget: si.planned_budget || 0,
          actual_spend: 0,
          display_order: si.display_order || 0,
        })
        .select("id")
        .single();

      if (insErr || !newInit) {
        console.error("[plan/restore] Initiative insert failed:", insErr?.message);
        continue;
      }
      restoredCount++;

      // Re-insert this initiative's tasks (reset to not_started)
      const tasksForInit = snapTasks.filter((t) => t.initiative_id === si.id);
      for (const t of tasksForInit) {
        await admin.from("tasks").insert({
          initiative_id: newInit.id,
          company_id: companyId,
          name: t.name,
          description: t.description || "",
          due_date: t.due_date,
          estimated_hours: t.estimated_hours || 0,
          status: "not_started",
          priority: t.priority || "medium",
          display_order: t.display_order || 0,
          dependency_ids: [],
        });
      }
    }

    // 8. Full restore also brings back the plan financials. Without this the
    //    dashboard showed 0 for Baseline/Stretch and all three projections
    //    even though the snapshot contained them.
    let projectionsRestored = 0;
    let targetsRestored = false;
    if (!onlyInitiativeId) {
      // 8a. Annual plan revenue targets (+ mirror onto the company record)
      const snapPlan = data.annualPlan || null;
      if (snapPlan) {
        const planUpdates = {
          baseline_revenue: Number(snapPlan.baseline_revenue) || 0,
          stretch_revenue: Number(snapPlan.stretch_revenue) || 0,
          operating_budget: Number(snapPlan.operating_budget) || 0,
          status: "active",
        };
        const { error: planErr } = await admin
          .from("annual_plans")
          .update(planUpdates)
          .eq("id", annualPlan.id);
        if (planErr) {
          console.error("[plan/restore] Annual plan restore failed:", planErr.message);
        } else {
          targetsRestored = true;
          console.log("[plan/restore] Restored plan targets:", JSON.stringify(planUpdates));
        }

        await admin
          .from("companies")
          .update({
            baseline_revenue: planUpdates.baseline_revenue,
            stretch_revenue: planUpdates.stretch_revenue,
            operating_budget: planUpdates.operating_budget,
          })
          .eq("id", companyId);
      }

      // 8b. Projections - replace current rows with the snapshot's
      const snapProjections: any[] = data.projections || [];
      if (snapProjections.length > 0) {
        await admin.from("projections").delete().eq("company_id", companyId);
        for (const sp of snapProjections) {
          const { error: prErr } = await admin.from("projections").insert({
            company_id: companyId,
            annual_plan_id: annualPlan.id,
            scenario: sp.scenario,
            period: sp.period || "monthly",
            by_product: sp.by_product || [],
            by_initiative: sp.by_initiative || [],
            monthly: sp.monthly || [],
          });
          if (prErr) {
            console.error("[plan/restore] Projection insert failed:", prErr.message);
          } else {
            projectionsRestored++;
          }
        }
        console.log("[plan/restore] Restored", projectionsRestored, "projection rows");
      }
    }

    console.log(
      "[plan/restore] Done. initiatives:", restoredCount, "of", initiativesToRestore.length,
      "| projections:", projectionsRestored,
      "| targets:", targetsRestored
    );

    /**
     * Do not report success when nothing came back.
     *
     * Individual initiative failures are logged and skipped, which is right
     * for a partial problem — but if EVERY initiative failed the restore did
     * not work, and saying "Plan restored" was exactly the misleading message
     * the customer saw.
     */
    if (initiativesToRestore.length > 0 && restoredCount === 0) {
      return NextResponse.json(
        {
          error:
            `None of the ${initiativesToRestore.length} initiative(s) in this ` +
            `snapshot could be restored. Your plan as it was before this ` +
            `attempt is saved in Plan History. Please try again or contact support.`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      restored: restoredCount,
      /** So the UI can say "3 of 4" rather than imply everything came back. */
      skipped: initiativesToRestore.length - restoredCount,
      projectionsRestored,
      targetsRestored,
      mode: onlyInitiativeId ? "single" : "full",
    });
  } catch (err: any) {
    console.error("[plan/restore] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
