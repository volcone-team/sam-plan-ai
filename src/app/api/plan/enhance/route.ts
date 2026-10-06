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
const ENHANCE_SYSTEM_PROMPT = `You are SAM Plan AI, a strategic revenue planning assistant.

You are given a business's CURRENT revenue plan (products, initiatives, targets).
Your job is to suggest IMPROVEMENTS — you are NOT rewriting the plan.

Return ONLY valid JSON (no markdown) in this exact shape:

{
  "suggestions": [
    {
      "type": "new_initiative" | "budget_change" | "date_change" | "target_change" | "product_update",
      "targetName": "string | null",   // name of the existing initiative/product this applies to; null for new_initiative
      "title": "string",               // short, plain-language summary of the suggestion
      "rationale": "string",           // one sentence: why you suggest this
      "current": { },                  // current value(s) for change types; {} for new_initiative
      "proposed": { }                  // proposed value(s)
    }
  ]
}

Rules:
- Suggest 3-8 high-value improvements. Quality over quantity.
- new_initiative: propose "proposed" as { name, description, libraryKey, activationMonth, plannedBudget, revenueBetter, tasks }
  - libraryKey MUST be one of the key= values from the INITIATIVE LIBRARY below. Do not invent one.
  - tasks is a FALLBACK only: [{ name, description, daysBeforeEvent (positive), estimatedHours, priority }].
    Where the workbook has an authored task template for the chosen libraryKey it is used instead of yours.
- budget_change: "current" as { plannedBudget }, "proposed" as { plannedBudget }
- date_change: "current" as { activationMonth }, "proposed" as { activationMonth }
- target_change: "current" as { baselineRevenue?, stretchRevenue? }, "proposed" as { baselineRevenue?, stretchRevenue? }
- product_update: "current" as { price? }, "proposed" as { price?, note? }
- Base suggestions on what's realistic for their budget, team, and what has worked.
- Every suggestion must be actionable and specific. No vague advice.
- Do NOT suggest deleting anything. Only additions and adjustments.
`;

export async function POST() {
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
    const planSummary = `CURRENT PLAN

Revenue Targets:
- Baseline: $${annualPlan?.baseline_revenue || company?.baseline_revenue || 0}
- Stretch: $${annualPlan?.stretch_revenue || company?.stretch_revenue || 0}
- Operating Budget: $${annualPlan?.operating_budget || company?.operating_budget || 0}
- Target Revenue: $${company?.target_revenue || 0}

Products:
${(products || []).map((p) => `- ${p.name} ($${p.price}, ${p.revenue_type})`).join("\n") || "None"}

Initiatives (name | channel | status | activation date | budget | projected revenue):
${initiatives.map((i: any) => `- ${i.name} | ${i.initiative_types?.channel || "unknown"} | ${i.status} | ${i.activation_date} | $${i.planned_budget} | $${i.revenue_better}`).join("\n")}

Suggest improvements to this plan as JSON.`;

    // 4. Call Claude
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set." }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Suggestions must come from the workbook library, same as generation.
    let libraryContext = "";
    try {
      const [library, aiContext] = await Promise.all([loadLibrary(supabase), loadAiContext(supabase)]);
      if (library.length > 0) {
        libraryContext =
          "\n\nINITIATIVE LIBRARY (the ONLY initiatives you may propose - return libraryKey verbatim):\n" +
          renderLibraryForPrompt(library, aiContext);
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

    // 6. Map AI targetName back to the real initiative/product id where possible
    const initByName = new Map((initiatives || []).map((i) => [i.name.toLowerCase(), i.id]));
    const prodByName = new Map((products || []).map((p) => [p.name.toLowerCase(), p.id]));

    const batchId = randomUUID();
    const validTypes = ["new_initiative", "budget_change", "date_change", "target_change", "product_update"];

    const rows = suggestions
      .filter((s: any) => validTypes.includes(s.type))
      .map((s: any) => {
        const name = (s.targetName || "").toLowerCase();
        let targetId: string | null = null;
        if (s.type === "product_update") targetId = prodByName.get(name) || null;
        else if (s.type !== "new_initiative" && s.type !== "target_change") targetId = initByName.get(name) || null;

        return {
          company_id: companyId,
          batch_id: batchId,
          suggestion_type: s.type,
          target_id: targetId,
          target_label: s.targetName || null,
          title: String(s.title || "Suggestion").slice(0, 300),
          rationale: String(s.rationale || "").slice(0, 500),
          current_value: s.current || {},
          proposed_value: s.proposed || {},
          status: "pending",
        };
      });

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
