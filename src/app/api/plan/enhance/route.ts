import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { logGenerationEvent } from "@/lib/generation-events";
import { classifyAiFailure, aiFailureLogDetail, operatorHint } from "@/lib/ai-errors";
import { loadLibrary, loadAiContext, renderLibraryForPrompt } from "@/lib/workbook/read";
import { checkEntitlement, recordUsage, statusForCode, serviceClient } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { toDateOnly, todayDateOnly } from "@/lib/plan-dates";
import { loadCompanyFit, partitionLibrary, rejectionReason } from "@/lib/recommend/company-eligibility";
import { suggestionChannel } from "@/lib/initiatives/suggestion-initiative";
import { ENHANCE_SYSTEM_PROMPT, buildPlanSummary } from "@/lib/plans/enhance-prompt";
import { buildSuggestionRows } from "@/lib/plans/suggestion-rows";

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

/**
 * POST /api/plan/enhance
 *
 * "Enhance Current Plan" — sends the customer's EXISTING plan to Claude and
 * asks for improvement suggestions. Saves each suggestion as `pending` in
 * plan_suggestions. NOTHING is applied to the live plan here — the user
 * accepts/rejects each suggestion separately (B.3 / B.4).
 *
 * Returns: { batchId, count } so the UI can load the review screen.
 */

export async function POST(request: Request) {
  // Hoisted so the outer catch can log a FAILED enhancement event. They stay
  // null until auth resolves, so an early failure logs nothing rather than
  // logging an unattributable row.
  let eventCompanyId: string | null = null;
  let eventUserId: string | null = null;

  try {
    console.log("[plan/enhance] Starting enhance run...");

    // 1. Auth
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

    // Only editors (owner/operator) can enhance
    if (!["owner", "operator"].includes(profile.role)) {
      console.log("[plan/enhance] Denied for role:", profile.role);
      return NextResponse.json({ error: "Your role cannot enhance the plan." }, { status: 403 });
    }

    const companyId = profile.company_id;
    eventCompanyId = companyId;
    eventUserId = user.id;
    console.log("[plan/enhance] Company:", companyId, "| user:", user.email);

    /**
     * Billing entitlement, before any paid work. Enhancement counts against the
     * same ai_uses_month allowance as generation, because both are Claude calls
     * that cost real money — metering only generation would leave an unbounded
     * path to the API.
     *
     * No-ops entirely while billing is disabled.
     */
    const billingDb = serviceClient();
    const entitlement = await checkEntitlement(
      billingDb,
      companyId,
      LIMIT_KEYS.AI_USES_MONTH
    );
    if (!entitlement.ok) {
      console.log("[plan/enhance] Blocked by billing:", entitlement.code);
      return NextResponse.json(
        { error: entitlement.code, message: entitlement.message, limit: entitlement.limit },
        { status: statusForCode(entitlement.code) }
      );
    }

    // 2. Load the current plan (products, initiatives, annual plan)
    const [
      { data: company },
      { data: products },
      { data: initiatives, error: initErr },
      { data: annualPlan },
    ] = await Promise.all([
      supabase.from("companies").select("target_revenue, baseline_revenue, stretch_revenue, operating_budget").eq("id", companyId).single(),
      supabase.from("products").select("id, name, price, revenue_type").eq("company_id", companyId).eq("is_active", true),
      supabase.from("initiatives").select("id, name, status, activation_date, planned_budget, revenue_better, initiative_types(channel)").eq("company_id", companyId),
      supabase.from("annual_plans").select("baseline_revenue, stretch_revenue, operating_budget").eq("company_id", companyId).order("year", { ascending: false }).limit(1).single(),
    ]);

    /**
     * WHICH YEAR is being enhanced.
     *
     * The caller passes the year it is showing. Without it this route had no
     * notion of a plan year at all, which is how enhancing 2026 produced
     * suggestions dated 2025: the model was handed a plan with no date context
     * and invented its own.
     *
     * Falls back to the current year rather than erroring, so an older client
     * that sends nothing still behaves sensibly.
     */
    const planYear = (() => {
      const raw = Number(new URL(request.url).searchParams.get("year"));
      return Number.isInteger(raw) && raw > 2000 && raw < 2200
        ? raw
        : new Date().getFullYear();
    })();

    const today = toDateOnly(todayDateOnly());

    /**
     * A plan year that has already finished cannot be enhanced.
     *
     * Every suggestion is work to be scheduled, and there is no valid date left
     * in a past year to schedule it on. Refusing here is clearer than returning
     * suggestions the user cannot act on — and it avoids spending an AI call to
     * produce them.
     */
    if (planYear < new Date().getFullYear()) {
      console.log("[plan/enhance] Refused: plan year", planYear, "is in the past");
      return NextResponse.json(
        {
          error:
            `The ${planYear} plan year has already finished, so there is nothing left to schedule. ` +
            `Switch to ${new Date().getFullYear()} or a future year to enhance it.`,
        },
        { status: 409 }
      );
    }

    if (initErr) {
      console.error("[plan/enhance] Failed to load initiatives:", initErr.message);
      return NextResponse.json(
        { error: "Could not read your plan: " + initErr.message },
        { status: 500 }
      );
    }

    if (!initiatives || initiatives.length === 0) {
      console.log("[plan/enhance] No existing plan to enhance (0 initiatives)");
      return NextResponse.json({ error: "You need an existing plan before enhancing it." }, { status: 400 });
    }

    console.log("[plan/enhance] Loaded plan:", products?.length || 0, "products,", initiatives.length, "initiatives");

    // 3. Build the plan summary for Claude
    const planSummary = buildPlanSummary({ today, planYear, company, annualPlan, products, initiatives });

    // 4. Call Claude
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set." }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Suggestions must come from the workbook library, same as generation.
    let libraryContext = "";
    // FIT for this company (all-null without a v2 intake: allowlist only).
    const fit = await loadCompanyFit(billingDb, companyId);
    try {
      const [library, aiContext] = await Promise.all([loadLibrary(supabase), loadAiContext(supabase)]);
      // FIT, then SCORE: only what suits this business, best first.
      const { eligible } = partitionLibrary(library, fit.ctx, fit.revenueWeight);
      if (eligible.length > 0) {
        libraryContext =
          "\n\nINITIATIVE LIBRARY (the ONLY initiatives you may propose - return libraryKey verbatim):\n" +
          renderLibraryForPrompt(eligible, aiContext);
      } else {
        console.error("[plan/enhance] Initiative library is empty - suggestions will not be workbook-grounded.");
      }
    } catch (wbErr) {
      console.error("[plan/enhance] Workbook load failed:", wbErr);
    }

    console.log("[plan/enhance] Calling Claude...");
    const claudeStart = Date.now();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: ENHANCE_SYSTEM_PROMPT + libraryContext,
      messages: [{ role: "user", content: planSummary }],
    });
    // Duration + token usage for the admin AI metrics.
    const durationMs = Date.now() - claudeStart;
    const tokensInput = response.usage?.input_tokens ?? null;
    const tokensOutput = response.usage?.output_tokens ?? null;
    console.log("[plan/enhance] Claude responded in", durationMs, "ms | output tokens:", tokensOutput);

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    // 5. Parse
    let parsed: any;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      const match = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) parsed = JSON.parse(match[1]);
      else {
        console.error("[plan/enhance] Could not parse AI response:", textBlock.text.slice(0, 300));
        return NextResponse.json({ error: "Could not parse AI response" }, { status: 500 });
      }
    }

    const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    console.log("[plan/enhance] AI returned", suggestions.length, "suggestions");

    if (suggestions.length === 0) {
      return NextResponse.json({ error: "The AI did not return any suggestions. Try again." }, { status: 500 });
    }

    // 6. Map the AI suggestions to pending rows (target ids resolved by name)
    const batchId = randomUUID();

    /**
     * FIT, enforced server-side: a new_initiative whose library key fails FIT
     * (or the allowlist) is dropped here with the rule's reason, rather than
     * shown and then refused when the user accepts it.
     */
    const fullLibraryByKey = new Map(
      (await loadLibrary(supabase, { includeInactive: true })).map((l) => [l.initiativeKey, l])
    );
    const passesFit = (s: { type?: unknown; proposed?: unknown }): boolean => {
      if (s.type !== "new_initiative") return true;
      const proposed = s.proposed && typeof s.proposed === "object" ? (s.proposed as Record<string, unknown>) : {};
      const key = suggestionChannel(proposed);
      const reason = rejectionReason(fullLibraryByKey.get(key), fit.ctx);
      if (reason) console.warn("[plan/enhance] Dropped ineligible new_initiative:", key, "|", reason);
      return !reason;
    };

    const rows = buildSuggestionRows(suggestions, { companyId, batchId, initiatives, products, passesFit });

    // 7. Clear any older pending suggestions for this company, then insert the new batch.
    //    (A fresh enhance run replaces stale pending suggestions.)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await adminClient.from("plan_suggestions").delete().eq("company_id", companyId).eq("status", "pending");
    console.log("[plan/enhance] Cleared old pending suggestions");

    const { error: insErr } = await adminClient.from("plan_suggestions").insert(rows);
    if (insErr) {
      console.error("[plan/enhance] Insert error:", insErr.message);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    console.log("[plan/enhance] Saved batch", batchId, "with", rows.length, "suggestions");

    // Log this enhancement for admin metrics. Reuses adminClient: the previous
    // user-scoped insert here was rejected by RLS on every run, silently.
    await logGenerationEvent(
      {
        companyId,
        userId: user.id,
        eventType: "plan_enhancement",
        status: "success",
        suggestionsCreated: rows.length,
        durationMs,
        model: MODEL,
        tokensInput,
        tokensOutput,
      },
      adminClient
    );

    // Metered only on success, for the same reason as generation: a failed run
    // must not consume the customer's allowance.
    await recordUsage(billingDb, companyId, LIMIT_KEYS.AI_USES_MONTH, entitlement.period);

    /**
     * NO GoHighLevel MILESTONE HERE, deliberately. Stated because the two
     * sibling AI routes (/api/generate-plan, /api/intake/build) both fire one
     * at exactly this point, so the absence would otherwise read as an
     * oversight.
     *
     * Enhancement is not generation. It writes `plan_suggestions` rows for an
     * EXISTING plan and creates no initiatives; the client's tag list has no
     * "plan enhanced" tag, and the only tag that could plausibly be stretched
     * to cover it — `plan generated` — is wired to their onboarding workflow.
     * Firing it would mail a welcome sequence to a long-standing customer for
     * pressing Enhance. The milestone is also one-shot per company, so for the
     * customers it would be wrong for it has already been spent anyway.
     */

    return NextResponse.json({ success: true, batchId, count: rows.length });
  } catch (err: any) {
    // Record the failure so a broken enhance path is visible on the dashboard
    // instead of just absent. Guarded: no company resolved means no attribution.
    if (eventCompanyId) {
      await logGenerationEvent({
        companyId: eventCompanyId,
        userId: eventUserId,
        eventType: "plan_enhancement",
        status: "failed",
        errorMessage: String(err?.message || "Internal error").slice(0, 500),
        model: MODEL,
      });
    }

    // Shared classification, so enhance reports an exhausted credit balance the
    // same way generation and chat do rather than returning the raw SDK message.
    const failure = classifyAiFailure(err);
    console.error(
      "[plan/enhance] Failed (", failure.kind, "):", aiFailureLogDetail(err)
    );
    const hint = operatorHint(failure.kind);
    if (hint) console.error("[plan/enhance]", hint);

    return NextResponse.json(
      { error: failure.message, kind: failure.kind, retryable: failure.retryable },
      { status: failure.status }
    );
  }
}
