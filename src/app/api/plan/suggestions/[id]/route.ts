import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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
    let activationDate: string;
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      // Full date string - use it directly (strip any time portion)
      activationDate = raw.split("T")[0];
    } else {
      // Month number - build a date in the current year
      const month = Number(raw);
      if (!month || month < 1 || month > 12) throw new Error("Invalid activation month: " + raw);
      const year = new Date().getFullYear();
      activationDate = new Date(year, month - 1, 1).toISOString().split("T")[0];
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

    const channel = String(proposed.channel || "custom");
    let typeId = (initTypes || []).find((t: any) => t.channel === channel)?.id || (initTypes || [])[0]?.id;

    if (!typeId) {
      const { data: newType } = await db.from("initiative_types").insert({
        name: channel.charAt(0).toUpperCase() + channel.slice(1),
        channel,
        owner: "system",
        benchmarks: {},
        project_template: { tasks: [], totalEstimatedHours: 0 },
        difficulty: { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
        ai_context: {},
        tier: 1,
        display_order: 99,
        is_active: true,
      }).select("id").single();
      typeId = newType?.id;
    }
    if (!typeId) throw new Error("Could not resolve an initiative type");

    // AI may return a full ISO date string ("2025-04-30") or a month number (1-12).
    const rawMonth = proposed.activationMonth;
    let activationDate: string;
    let eventDate: string;
    if (typeof rawMonth === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawMonth)) {
      // Full date - use it (strip time), event 14 days later
      activationDate = rawMonth.split("T")[0];
      const evD = new Date(activationDate);
      evD.setDate(evD.getDate() + 14);
      eventDate = evD.toISOString().split("T")[0];
    } else {
      // Month number or fallback
      const month = Number(rawMonth) || (new Date().getMonth() + 1);
      const mClamped = Math.min(Math.max(month, 1), 12);
      const year = new Date().getFullYear();
      activationDate = new Date(year, mClamped - 1, 1).toISOString().split("T")[0];
      eventDate = new Date(year, mClamped - 1, 15).toISOString().split("T")[0];
    }
    const revenueBetter = Number(proposed.revenueBetter) || 0;

    console.log("[applySuggestion] new_initiative:", proposed.name, "| channel:", channel, "| date:", activationDate);

    const { error } = await db.from("initiatives").insert({
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
    });
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error("Unknown suggestion type: " + type);
}
