import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { liveLimitResponse } from "@/lib/billing/live-limits";
import { applySuggestion, SuggestionRejected, SuggestionOverLimit } from "@/lib/plans/apply-suggestion";
import { isGoalChangeType } from "@/lib/plans/suggestion-policy";

/** Accepting a new_initiative may involve a ~30s AI call for its task list. */
export const maxDuration = 60;

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
 *   - product_update -> update product price
 * On "rejected", it's simply marked rejected and ignored.
 *
 * Revenue goals (baseline and stretch) are fixed for the year. Accepting an
 * old "target_change" suggestion is refused with 409 `goal_change_retired`:
 * nothing is written and the row stays pending (the next enhance run clears
 * it). Rejecting one still works.
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

    if (decision === "accepted" && isGoalChangeType(suggestion.suggestion_type)) {
      console.warn("[plan/suggestions/id] Refused goal change:", id);
      return NextResponse.json(
        { code: "goal_change_retired", error: "Revenue goals can't be changed from Enhance Plan." },
        { status: 409 }
      );
    }

    if (decision === "accepted") {
      try {
        await applySuggestion(adminClient, companyId, suggestion);
        console.log("[plan/suggestions/id] Applied:", suggestion.suggestion_type);
      } catch (applyErr: any) {
        if (applyErr instanceof SuggestionOverLimit) {
          // Left pending, like a FIT refusal: nothing was written, and the
          // suggestion can be accepted after an upgrade or a deletion.
          console.warn("[plan/suggestions/id] Refused by plan limit:", applyErr.result.code);
          return liveLimitResponse(applyErr.result);
        }
        if (applyErr instanceof SuggestionRejected) {
          // Left pending: nothing was applied, and the user can still reject it.
          console.warn("[plan/suggestions/id] Rejected by FIT:", applyErr.message);
          return NextResponse.json(
            { error: applyErr.message, reason: applyErr.message, code: "ineligible" },
            { status: 409 }
          );
        }
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
