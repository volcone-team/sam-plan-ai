import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { toDateOnly, clampNotBefore, todayDateOnly, clampDayOfMonth } from "@/lib/plan-dates";
import { loadTaskTemplates } from "@/lib/workbook/read";
import { materialiseTasks, materialiseAiTasks, templateRunwayDays } from "@/lib/workbook/materialise";

/**
 * PATCH /api/plan/suggestions/[id]
 *
 * Accept or reject a single enhancement suggestion.
 * Body: { decision: "accepted" | "rejected" }
 *
 * On "accepted", the suggestion is APPLIED to the live plan:
 *   - new_initiative -> insert a new initiative
 *   - budget_change  -> update initiative planned_budget
 *   - date_change    -> update initiative activation_date
 *   - target_change  -> update annual plan + company revenue targets
 *   - product_update -> update product price
 * On "rejected", it's simply marked rejected and ignored.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const decision = body?.decision;

    console.log("[plan/suggestions/id] Decision:", id, "->", decision);

    if (decision !== "accepted" && decision !== "rejected") {
      return NextResponse.json({ error: "decision must be 'accepted' or 'rejected'" }, { status: 400 });
    }

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
      return NextResponse.json({ error: "Your role cannot change the plan." }, { status: 403 });
    }

    const companyId = profile.company_id;
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: suggestion, error: loadErr } = await adminClient
      .from("plan_suggestions")
      .select("*")
      .eq("id", id)
      .single();

    if (loadErr || !suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }
    if (suggestion.company_id !== companyId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json({ error: "This suggestion was already decided." }, { status: 400 });
    }

    if (decision === "accepted") {
      try {
        await applySuggestion(adminClient, companyId, suggestion);
        console.log("[plan/suggestions/id] Applied:", suggestion.suggestion_type);
      } catch (applyErr: any) {
        console.error("[plan/suggestions/id] Apply failed:", applyErr?.message || applyErr);
        return NextResponse.json(
          { error: "Could not apply this suggestion: " + (applyErr?.message || "unknown error") },
          { status: 500 }
        );
      }
    }

    const { error: updErr } = await adminClient
      .from("plan_suggestions")
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq("id", id);

    if (updErr) {
      console.error("[plan/suggestions/id] Status update error:", updErr.message);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    console.log("[plan/suggestions/id] Marked", id, "as", decision);
    return NextResponse.json({ success: true, decision });
  } catch (err: any) {
    console.error("[plan/suggestions/id] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/** Applies an accepted suggestion to the live plan. */
async function applySuggestion(db: SupabaseClient, companyId: string, s: any): Promise<void> {
  const proposed = s.proposed_value || {};
  const type = s.suggestion_type;

  if (type === "budget_change") {
    if (!s.target_id) throw new Error("No target initiative for budget change");
    const budget = Number(proposed.plannedBudget) || 0;
    console.log("[applySuggestion] budget_change:", s.target_id, "->", budget);
    const { error } = await db.from("initiatives").update({ planned_budget: budget }).eq("id", s.target_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }

  if (type === "date_change") {
    if (!s.target_id) throw new Error("No target initiative for date change");
    // AI may return a full ISO date string ("2025-01-31") or a month number (1-12).
    const raw = proposed.activationMonth;
    const today = todayDateOnly();
    let activationDate: string;
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      /**
       * FLOORED AT TODAY.
       *
       * This used to take the model's date verbatim, which is how enhancing
       * the 2026 plan moved an initiative to 2025 — a date already in the
       * past, with tasks the user could never perform. `new_initiative` below
       * has always clamped; this branch did not.
       */
      activationDate = toDateOnly(clampNotBefore(raw.split("T")[0], today));
    } else {
      // Month number - build a date in the current year, never in the past.
      const month = Number(raw);
      if (!month || month < 1 || month > 12) throw new Error("Invalid activation month: " + raw);
      const year = new Date().getFullYear();
      activationDate = toDateOnly(
        clampNotBefore(new Date(year, month - 1, 1), today)
      );
    }
    console.log("[applySuggestion] date_change:", s.target_id, "->", activationDate);
    const { error } = await db.from("initiatives").update({ activation_date: activationDate }).eq("id", s.target_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }

  if (type === "target_change") {
    const updates: Record<string, number> = {};
    if (proposed.baselineRevenue != null) updates.baseline_revenue = Number(proposed.baselineRevenue) || 0;
    if (proposed.stretchRevenue != null) updates.stretch_revenue = Number(proposed.stretchRevenue) || 0;
    if (Object.keys(updates).length === 0) throw new Error("No target values to apply");
    console.log("[applySuggestion] target_change:", updates);
    const { data: annualPlan } = await db.from("annual_plans").select("id").eq("company_id", companyId).order("year", { ascending: false }).limit(1).single();
    if (annualPlan) {
      const { error: apErr } = await db.from("annual_plans").update(updates).eq("id", annualPlan.id);
      if (apErr) throw new Error(apErr.message);
    }
    const { error: compErr } = await db.from("companies").update(updates).eq("id", companyId);
    if (compErr) throw new Error(compErr.message);
    return;
  }

  if (type === "product_update") {
    if (!s.target_id) throw new Error("No target product for product update");
    const updates: Record<string, number> = {};
    if (proposed.price != null) updates.price = Number(proposed.price) || 0;
    if (Object.keys(updates).length === 0) throw new Error("No product changes to apply");
    console.log("[applySuggestion] product_update:", s.target_id, updates);
    const { error } = await db.from("products").update(updates).eq("id", s.target_id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return;
  }

  if (type === "new_initiative") {
    const [{ data: annualPlan }, { data: products }, { data: initTypes }] = await Promise.all([
      db.from("annual_plans").select("id").eq("company_id", companyId).order("year", { ascending: false }).limit(1).single(),
      db.from("products").select("id").eq("company_id", companyId).eq("is_active", true).order("display_order").limit(1),
      db.from("initiative_types").select("id, channel").eq("is_active", true),
    ]);

    if (!annualPlan) throw new Error("No annual plan to attach the initiative to");
    const productId = products?.[0]?.id;
    if (!productId) throw new Error("No product to attach the initiative to");

    // The workbook library key IS the channel. `channel` is only a fallback for
    // suggestions generated before the library was wired in.
    const channel = String(proposed.libraryKey || proposed.channel || "custom");
    let typeId = (initTypes || []).find((t: any) => t.channel === channel)?.id || (initTypes || [])[0]?.id;

    if (!typeId) {
      const { data: newType } = await db.from("initiative_types").insert({
        name: channel.charAt(0).toUpperCase() + channel.slice(1),
        channel,
        owner: "system",
        benchmarks: {},
        project_template: { tasks: [], totalEstimatedHours: 0 },
        // Workbook scale is 1-5, where 5 means "very hard". 3 is the neutral default.
        difficulty: { effortToImplement: 3, skillExpertiseRequired: 3, timeToResults: 3, costToRun: 3 },
        ai_context: {},
        tier: 1,
        display_order: 99,
        is_active: true,
      }).select("id").single();
      typeId = newType?.id;
    }
    if (!typeId) throw new Error("Could not resolve an initiative type");

    // AI may return a full ISO date string ("2025-04-30") or a month number (1-12).
    // Tasks come from the workbook template for this library key, exactly as in
    // generation. Accepting a suggestion used to create an initiative with NO
    // tasks at all, so the plan looked generated but had no project plan behind it.
    const templates = (await loadTaskTemplates(db, [channel])).get(channel) || [];
    const runway = templateRunwayDays(templates);

    // Dates floored at today, so accepting a suggestion never back-dates work.
    // The event was previously hardcoded to the 15th (or activation + 14 days)
    // and written via toISOString(), which shifts the calendar day.
    const today = todayDateOnly();
    const rawMonth = proposed.activationMonth;
    let eventDateObj: Date;
    if (typeof rawMonth === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawMonth)) {
      eventDateObj = clampNotBefore(rawMonth.split("T")[0], today);
    } else {
      const month = Number(rawMonth) || new Date().getMonth() + 1;
      const mClamped = Math.min(Math.max(month, 1), 12);
      const year = new Date().getFullYear();
      // Mid-month only as a placeholder, when no day is supplied at all.
      const day = clampDayOfMonth(year, mClamped, 15);
      eventDateObj = clampNotBefore(new Date(year, mClamped - 1, day), today);
    }
    // The event must leave room for its own preparation.
    if (runway > 0) {
      eventDateObj = clampNotBefore(
        eventDateObj,
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + runway)
      );
    }
    // Activation is when preparation starts.
    const activationDateObj = clampNotBefore(
      new Date(eventDateObj.getFullYear(), eventDateObj.getMonth(), eventDateObj.getDate() - runway),
      today
    );
    const activationDate = toDateOnly(activationDateObj);
    const eventDate = toDateOnly(eventDateObj);
    const revenueBetter = Number(proposed.revenueBetter) || 0;

    console.log("[applySuggestion] new_initiative:", proposed.name, "| channel:", channel, "| date:", activationDate);

    const { data: created, error } = await db.from("initiatives").insert({
      company_id: companyId,
      annual_plan_id: annualPlan.id,
      product_id: productId,
      initiative_type_id: typeId,
      name: String(proposed.name || s.title || "New Initiative"),
      description: String(proposed.description || ""),
      kind: "one-time",
      status: "planned",
      activation_date: activationDate,
      event_date: eventDate,
      revenue_good: Math.round(revenueBetter * 0.7),
      revenue_better: revenueBetter,
      revenue_best: Math.round(revenueBetter * 1.3),
      planned_budget: Number(proposed.plannedBudget) || 0,
      actual_spend: 0,
      display_order: 0,
    }).select("id").single();
    if (error) throw new Error(error.message);

    // Attach the project plan: workbook template where it exists, the
    // suggestion's own fallback list otherwise, so an accepted suggestion is
    // never an initiative with nothing to do.
    const tasks = templates.length > 0
      ? materialiseTasks(templates, { eventDate: eventDateObj, floor: today })
      : materialiseAiTasks(proposed.tasks, { eventDate: eventDateObj, floor: today });

    if (!created?.id) {
      console.error("[applySuggestion] initiative id missing - tasks not attached");
      return;
    }
    if (tasks.length === 0) {
      console.warn("[applySuggestion] no workbook template and no fallback tasks for", channel);
      return;
    }
    const { error: taskErr } = await db.from("tasks").insert(
      tasks.map((t) => ({
        id: t.id,
        initiative_id: created.id,
        company_id: companyId,
        name: t.name,
        description: t.description,
        due_date: t.dueDate,
        estimated_hours: t.estimatedHours,
        status: "not_started",
        priority: t.priority,
        display_order: t.displayOrder,
        dependency_ids: t.dependencyIds,
      }))
    );
    if (taskErr) throw new Error("Initiative saved but its tasks failed: " + taskErr.message);
    console.log("[applySuggestion] attached", tasks.length,
      templates.length > 0 ? "workbook tasks" : "fallback tasks", "to", proposed.name);
    return;
  }

  throw new Error("Unknown suggestion type: " + type);
}
