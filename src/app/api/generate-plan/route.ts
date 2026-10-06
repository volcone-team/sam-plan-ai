import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requirePlanEditor } from "@/lib/require-plan-editor";
import { checkEntitlement, recordUsage, statusForCode, serviceClient } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { logGenerationEvent, type GenerationEventType } from "@/lib/generation-events";
import { classifyAiFailure, aiFailureLogDetail, operatorHint } from "@/lib/ai-errors";
import { toDateOnly, clampDayOfMonth, resolvePlanStart, planMonthToCalendar, todayDateOnly, requiredRunwayDays } from "@/lib/plan-dates";
import { sequenceEventDates } from "@/lib/plan-schedule";
import { loadLibrary, loadTaskTemplates, loadAiContext, renderLibraryForPrompt, type LibraryEntry } from "@/lib/workbook/read";
import { materialiseTasks, materialiseAiTasks, templateRunwayDays } from "@/lib/workbook/materialise";

// Claude needs more than the default serverless budget to produce a full plan.
// NOTE: Vercel Hobby caps functions at 10s regardless of this value; Pro honours it.
export const maxDuration = 300;

// Model is env-overridable so it can be rotated without a code change.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

// Shapes of the loosely-typed JSON we read (AI output, admin workbook rows).
// These are descriptive only - the values come from JSON.parse / Supabase.

type GeneratedTask = {
  name: string;
  description?: string;
  daysBeforeEvent?: number;
  estimatedHours?: number;
  priority?: string;
};

type GeneratedInitiative = {
  name: string;
  description?: string;
  kind: string;
  /** Key into wb_initiative_library. Replaces the old free-text channel enum. */
  libraryKey?: string;
  channel?: string;
  activationMonth?: number;
  /** Day of month the initiative actually happens, 1-28. Clamped server-side. */
  eventDay?: number;
  trafficInput?: number;
  revenueGood?: number;
  revenueBetter?: number;
  revenueBest?: number;
  plannedBudget?: number;
  productIndex: number;
  /**
   * Tasks are NOT generated any more - they come from the workbook's authored
   * task template for this initiative. Kept optional so an older cached
   * response still parses.
   */
  tasks?: GeneratedTask[];
};

type GeneratedPlan = {
  annualPlan?: { baselineRevenue?: number; stretchRevenue?: number; operatingBudget?: number };
  initiatives?: GeneratedInitiative[];
  monthlyProjections?: Record<string, number[] | { monthly?: number[]; revenues?: number[] } | undefined>;
};

// ------------------------------------------------------------------
// POST /api/generate-plan
// Accepts questionnaire answers, calls Claude to generate a revenue
// plan, then persists products/initiatives/projections/tasks to the
// user's company in Supabase.
// ------------------------------------------------------------------

function buildSystemPrompt(startMonth: number, planMonths: number, startYear: number, startDay: number, todayStr: string): string {
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const startName = monthNames[startMonth - 1];
  const endMonth = ((startMonth - 1 + planMonths - 1) % 12) + 1;
  const endYear = startYear + Math.floor((startMonth - 1 + planMonths - 1) / 12);
  const endName = monthNames[endMonth - 1];

  return `You are SAM Plan AI, a strategic revenue planning assistant for service-based businesses.

Given the business questionnaire answers below, generate a ${planMonths}-month revenue plan starting from ${startName} ${startYear} through ${endName} ${endYear}.

IMPORTANT: The plan covers ${planMonths} months. Month 1 in your output = ${startName} ${startYear}. All activationMonth values must be between 1 and ${planMonths}.

Your response MUST be valid JSON (no markdown, no explanation) matching this exact schema:

{
  "products": [],
  "initiatives": [
    {
      "name": "string",
      "description": "string",
      "kind": "one-time" | "recurring" | "evergreen",
      "libraryKey": "string (MUST be one of the key= values from the INITIATIVE LIBRARY below - do not invent one)",
      "activationMonth": number (1-${planMonths}),
      "eventDay": number (1-28, the day of the month the initiative actually happens),
      "trafficInput": number,
      "revenueGood": number,
      "revenueBetter": number,
      "revenueBest": number,
      "plannedBudget": number,
      "productIndex": number (index into products array),
      "tasks": [
        {
          "name": "string",
          "description": "string",
          "daysBeforeEvent": number (days BEFORE the event this task is due; 0 = on the day. Always positive.),
          "estimatedHours": number,
          "priority": "low" | "medium" | "high" | "critical"
        }
      ]
    }
  ],
  "annualPlan": {
    "baselineRevenue": number,
    "stretchRevenue": number,
    "operatingBudget": number
  },
  "monthlyProjections": {
    "good": [number x ${planMonths}],
    "better": [number x ${planMonths}],
    "best": [number x ${planMonths}]
  }
}

Guidelines:
- SELECT every initiative from the INITIATIVE LIBRARY below and return its libraryKey verbatim. Do NOT invent initiatives, channels or keys - anything not in the library is rejected.
- The workbook holds an authored task template for most initiatives, and where it does, YOUR tasks are ignored in favour of it. Still return a task list for every initiative: it is the fallback for the initiatives the workbook has not been filled in for yet.
- Task daysBeforeEvent is the number of days BEFORE the event, always positive, ordered largest first.
- Use the library's difficulty (1-5), speed to results, price tier and WHEN/NEEDS/AVOID guidance to decide which initiatives suit this business.
- Do NOT generate or invent products. The user's products are provided as-is and will be inserted separately. Leave the "products" array empty in your response.
- All initiatives must reference a productIndex. Use 0 for the first product the user listed, 1 for the second, etc. If the user only has one product, all initiatives use productIndex 0.
- Generate 4-8 initiatives spread across the plan period
- Match initiative channels to what has worked for the user
- Revenue projections should sum to roughly the user's stated goal (scaled to the plan period) in the "better" scenario
- The "good" scenario is ~70% of goal, "best" is ~130% of goal
- Budget should reflect their stated monthly marketing budget x 12
- Tasks for each initiative should be actionable, with realistic hour estimates
- Consider their team size, available hours, and business stage when recommending effort levels
- If they have a small email list or no social following, favor low-cost initiatives like referrals and content
- If they have budget, include paid ads or challenges
- Spread initiatives across the ${planMonths} months, not front-loaded
- Revenue projections array must have exactly ${planMonths} entries
- activationMonth is RELATIVE TO THE PLAN, not the calendar. activationMonth 1 = ${startName} ${startYear}. Do NOT assume activationMonth 1 means January.
- Do NOT name initiatives after calendar quarters or halves ("Q1", "Q3", "Mid-Year", "Year-End") unless that label is actually correct for the calendar month it lands in. Name them for the play, not the quarter.
- The plan starts on day ${startDay} of ${startName} ${startYear} (today is ${todayStr}). An initiative's event must leave room for its OWN preparation: if its earliest task is 21 days before the event, the event must be at least 21 days after ${todayStr}. Never schedule an event so early that one of its own tasks would fall before ${todayStr}. If activationMonth 1 has no room, use activationMonth 2 or later.
- NO TWO initiatives may happen on the same day, and their preparation windows must not overlap. Assume ONE launch is being prepared at a time: the next initiative's preparation begins only after the previous one's event. Space the eventDay/activationMonth values accordingly across the ${planMonths} months. Evergreen initiatives are continuous and exempt.
- Every initiative MUST include an eventDay: the day of its activationMonth the initiative actually happens (1-28, so it is valid in every month).
- Task daysBeforeEvent is a COUNT OF DAYS BEFORE the event and must be POSITIVE. Preparation work happens BEFORE the event: build the asset first, then promote, then the event, then follow-up. A task with daysBeforeEvent 14 is due 14 days before eventDay.
- Order each initiative's tasks from the largest daysBeforeEvent (earliest) to the smallest (closest to the event).
- Keep output COMPACT: max 4 tasks per initiative, short descriptions (one sentence). Do not add fields beyond the schema.
`;
}

export async function POST(request: Request) {
  console.log("[generate-plan] === Request received ===");

  // Hoisted out of the try so the outer catch can log a FAILED generation
  // event. Both stay null/default until they are actually resolved, so a
  // failure that happens before authorization cannot log a bogus event.
  let eventCompanyId: string | null = null;
  let eventUserId: string | null = null;
  let eventType: GenerationEventType = "plan_generation";

  try {
    // 1. Authorization: only owner/operator may generate/regenerate the plan.
    const check = await requirePlanEditor();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

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

    const companyId = check.companyId;
    eventCompanyId = companyId;
    eventUserId = check.userId;

    /**
     * 2. Billing entitlement: is this account allowed to generate, and has it
     *    any allowance left this period?
     *
     * Runs BEFORE the body is parsed and long before Claude is called, because a
     * refusal must not cost money. Usage is recorded only after a SUCCESSFUL
     * generation (see recordUsage below), so a failed run does not burn an
     * allowance the customer never received.
     *
     * No-ops entirely while billing is disabled, so today's behaviour is
     * unchanged until a super admin turns Stripe on.
     */
    const billingDb = serviceClient();
    const entitlement = await checkEntitlement(
      billingDb,
      companyId,
      LIMIT_KEYS.AI_USES_MONTH
    );
    if (!entitlement.ok) {
      console.log(
        "[generate-plan] Blocked by billing for company", companyId, "|", entitlement.code
      );
      return NextResponse.json(
        {
          error: entitlement.code,
          message: entitlement.message,
          limit: entitlement.limit,
        },
        { status: statusForCode(entitlement.code) }
      );
    }

    // 3. Parse the request body first - we need targetYear to resolve the plan.
    const body = await request.json();
    const questionnaire = body.questionnaire;
    const targetYear: number | undefined =
      typeof body.targetYear === "number" && body.targetYear > 2000 ? body.targetYear : undefined;
    // The client knows whether this run is a regeneration (it read the
    // regen-mode flag). Optional: older callers omit it and we infer below.
    const isRegenerationFlag: boolean | undefined =
      typeof body.isRegeneration === "boolean" ? body.isRegeneration : undefined;

    if (!questionnaire) {
      return NextResponse.json({ error: "Missing questionnaire data" }, { status: 400 });
    }

    // 4. Determine whether this is a first-time generation or a regeneration.
    //    Must be decided BEFORE we write anything: after generation the company
    //    always looks like it has a plan. If the client didn't tell us, fall
    //    back to "has this company ever had a plan snapshotted?".
    let isRegeneration = isRegenerationFlag;
    if (isRegeneration === undefined) {
      const { count: snapshotCount, error: snapErr } = await supabase
        .from("plan_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (snapErr) {
        console.error("[generate-plan] Could not count snapshots:", snapErr.message);
      }
      isRegeneration = (snapshotCount ?? 0) > 0;
    }
    eventType = isRegeneration ? "plan_regeneration" : "plan_generation";
    console.log("[generate-plan] Event type:", eventType);

    // 4b. Resolve the annual plan to generate into.
    //    With a targetYear (future-year draft) attach to THAT year's plan,
    //    creating it if needed. Without one, use the most recent plan.
    let annualPlan: { id: string } | null = null;
    if (targetYear) {
      const { data: existing } = await supabase
        .from("annual_plans")
        .select("id")
        .eq("company_id", companyId)
        .eq("year", targetYear)
        .maybeSingle();
      if (existing) {
        annualPlan = existing;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("annual_plans")
          .insert({ company_id: companyId, year: targetYear, baseline_revenue: 0, stretch_revenue: 0, operating_budget: 0, status: "draft" })
          .select("id")
          .single();
        if (createErr || !created) {
          return NextResponse.json({ error: "Could not create the plan for " + targetYear }, { status: 500 });
        }
        annualPlan = created;
      }
    } else {
      const { data: latest } = await supabase
        .from("annual_plans")
        .select("id")
        .eq("company_id", companyId)
        .order("year", { ascending: false })
        .limit(1)
        .single();
      annualPlan = latest;
    }

    if (!annualPlan) {
      return NextResponse.json({ error: "No annual plan found" }, { status: 400 });
    }

    // 5. Call Claude
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !apiKey.startsWith("sk-ant-")) {
      console.error(
        "[generate-plan] ANTHROPIC_API_KEY missing or malformed.",
        "present:", !!apiKey, "| length:", apiKey?.length || 0
      );
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set or is malformed on the server." },
        { status: 500 }
      );
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userMessage = `Here are the questionnaire answers for this business:

Revenue Goal: $${questionnaire.annualRevenueGoal || 0}/year
Prior Year Revenue: $${questionnaire.priorYearRevenue || 0}
Planning Period: ${questionnaire.planningPeriod || "12-months"}

Products/Services they sell:
${(questionnaire.products || []).map((p: { name?: string; type?: string; price?: number }) => `- ${p.name} (${p.type}, $${p.price})`).join("\n") || "None specified"}

What has worked before: ${(questionnaire.whatsWorked || []).join(", ") || "Nothing specified"}
Notes: ${questionnaire.whatsWorkedNotes || "None"}

Ideal Customer: ${questionnaire.idealCustomer || "Not specified"}
Industry: ${questionnaire.industry || "Not specified"}
Business Type: ${questionnaire.businessType || "Not specified"}
Biggest Problem they solve: ${questionnaire.biggestProblem || "Not specified"}

Current Assets:
- Email list: ${questionnaire.emailListSize || 0}
- Monthly website visitors: ${questionnaire.monthlyWebsiteVisitors || 0}
- Social following: ${questionnaire.socialFollowing || 0}
- Existing customers: ${questionnaire.existingCustomers || 0}
- Monthly leads: ${questionnaire.monthlyLeads || 0}

Budget & Team:
- Monthly marketing budget: $${questionnaire.monthlyMarketingBudget || 0}
- Team size: ${questionnaire.teamSize || 1}
- Hours available per week: ${questionnaire.hoursAvailablePerWeek || 10}
- Business stage: ${questionnaire.businessStage || "solo"}

Obstacles: ${(questionnaire.obstacles || []).join(", ") || "None specified"}
Obstacle notes: ${questionnaire.obstacleNotes || "None"}

Generate a complete revenue plan as JSON.`;

    // Determine planning period and start month
    const planPeriodRaw = questionnaire.planningPeriod || "12-months";
    const planMonths = planPeriodRaw === "3-months" ? 3 : planPeriodRaw === "6-months" ? 6 : 12;
    const now = new Date();
    // Month 1 of the plan. Rule and rationale live in resolvePlanStart, which is
    // unit tested - a plan must never be generated into the past.
    const { startYear, startMonth } = resolvePlanStart(targetYear, now);
    // Nothing generated may be dated before today. Getting the start MONTH right
    // is not sufficient: on 27 September, day 1 of the start month and an
    // AI-chosen event day of 15 are both already gone.
    const planFloor = todayDateOnly(now);

    console.log("[generate-plan] Plan window starts", startYear, "month", startMonth, "| months:", planMonths);

    // 5b. Load initiative types from DB to feed into the prompt
    let initiativeTypesContext = "";
    try {
      const { data: initTypes } = await supabase
        .from("initiative_types")
        .select("name, channel, description, benchmarks, difficulty, ai_context, tier")
        .eq("is_active", true)
        .order("tier", { ascending: true });

      if (initTypes && initTypes.length > 0) {
        console.log("[generate-plan] Loaded", initTypes.length, "initiative types from DB");
        initiativeTypesContext = "\n\nAVAILABLE INITIATIVE TYPES (pick from these when creating initiatives):\n" +
          initTypes.map((t: {
            name?: string;
            channel?: string;
            description?: string | null;
            tier?: number;
            difficulty?: Record<string, number> | null;
            ai_context?: Record<string, string> | null;
          }) => {
            const diff = t.difficulty || {};
            const ai = t.ai_context || {};
            return `- ${t.name} (channel: ${t.channel}, tier: ${t.tier})\n` +
              `  Description: ${t.description || ai.description || ""}\n` +
              `  Sizing: ${ai.sizingGuidance || ""}\n` +
              `  Difficulty: effort=${diff.effortToImplement || 5}/10, cost=${diff.costToRun || 5}/10`;
          }).join("\n");
      } else {
        console.log("[generate-plan] No initiative types in DB, using defaults");
      }
    } catch (err) {
      console.log("[generate-plan] Failed to load initiative types:", err);
    }

    // 5c. Load workbook data (benchmarks/context from admin-uploaded Excel)
    // 5c. The workbook IS the brain. Instead of dumping the first 3 sheets of raw
    //      spreadsheet at the model (which discarded every task template), send
    //      the structured initiative library and let the model SELECT from it.
    let workbookContext = "";
    let libraryKeys = new Set<string>();
    let libraryByKey = new Map<string, LibraryEntry>();
    try {
      const [library, aiContext] = await Promise.all([
        loadLibrary(supabase),
        loadAiContext(supabase),
      ]);
      libraryKeys = new Set(library.map((l) => l.initiativeKey));
      libraryByKey = new Map(library.map((l) => [l.initiativeKey, l]));
      if (library.length > 0) {
        workbookContext =
          "\n\nINITIATIVE LIBRARY (the ONLY initiatives you may choose from - return libraryKey verbatim):\n" +
          renderLibraryForPrompt(library, aiContext);
        console.log("[generate-plan] Library:", library.length, "initiatives |", workbookContext.length, "chars");
      } else {
        console.error("[generate-plan] Initiative library is EMPTY - has migration 018 been applied and the workbook re-uploaded?");
      }
    } catch (wbErr) {
      console.error("[generate-plan] Workbook load failed:", wbErr);
    }

    const systemPrompt = buildSystemPrompt(startMonth, planMonths, startYear, planFloor.getDate(), toDateOnly(planFloor)) + initiativeTypesContext + workbookContext;

    console.log("[generate-plan] System prompt size:", systemPrompt.length, "chars");
    const claudeStart = Date.now();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    // Captured here and carried to step 7g: how long the AI call took and what
    // it cost. duration_ms/model/tokens were previously never populated.
    const durationMs = Date.now() - claudeStart;
    const tokensInput = response.usage?.input_tokens ?? null;
    const tokensOutput = response.usage?.output_tokens ?? null;
    console.log(
      "[generate-plan] Claude responded in", durationMs, "ms",
      "| stop_reason:", response.stop_reason,
      "| output tokens:", tokensOutput
    );
    if (response.stop_reason === "max_tokens") {
      console.error("[generate-plan] Output hit the token cap - JSON likely truncated");
    }

    // 6. Parse Claude's response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let plan: GeneratedPlan;
    try {
      plan = JSON.parse(textBlock.text);
    } catch {
      // Try to extract JSON from markdown code blocks
      const match = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        plan = JSON.parse(match[1]);
      } else {
        console.error("[generate-plan] Could not parse AI response:", textBlock.text.slice(0, 500));
        return NextResponse.json({ error: "Could not parse AI response" }, { status: 500 });
      }
    }

    // 7. Persist to database

    // 7a. Update annual plan with revenue targets
    if (plan.annualPlan) {
      await supabase
        .from("annual_plans")
        .update({
          baseline_revenue: plan.annualPlan.baselineRevenue || 0,
          stretch_revenue: plan.annualPlan.stretchRevenue || 0,
          operating_budget: plan.annualPlan.operatingBudget || 0,
          status: "active",
        })
        .eq("id", annualPlan.id);
    }

    // 7b. Persist the user's questionnaire products (not AI-generated).
    //     Reuse an existing product with the same name instead of inserting a
    //     duplicate. Previously every regeneration re-inserted the full list,
    //     so a company accumulated the same product many times over. We match
    //     by name rather than deleting, because kept initiatives still
    //     reference the existing product rows via FK.
    const productIds: string[] = [];
    const userProducts = questionnaire.products || [];

    const { data: existingProducts } = await supabase
      .from("products")
      .select("id, name")
      .eq("company_id", companyId);
    const productIdByName = new Map<string, string>(
      (existingProducts || []).map((pr: { id: string; name: string }) => [
        String(pr.name).trim().toLowerCase(),
        pr.id,
      ])
    );

    for (let i = 0; i < userProducts.length; i++) {
      const prod = userProducts[i];
      const name = prod.name || "Untitled Product";
      const key = String(name).trim().toLowerCase();
      const isRecurring = prod.type === "membership" || prod.type === "subscription" || prod.type === "coaching";
      const price = prod.price || 0;
      const tier = price >= 2000 ? "high" : price >= 500 ? "mid" : "low";

      // Already have this product - refresh its details and reuse the row.
      const existingId = productIdByName.get(key);
      if (existingId) {
        await supabase
          .from("products")
          .update({
            price,
            revenue_type: isRecurring ? "recurring" : "one-time",
            ticket_tier: tier,
            is_active: true,
            display_order: i,
          })
          .eq("id", existingId);
        productIds.push(existingId);
        continue;
      }

      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert({
          company_id: companyId,
          name,
          description: "",
          price,
          revenue_type: isRecurring ? "recurring" : "one-time",
          ticket_tier: tier,
          is_active: true,
          display_order: i,
        })
        .select("id")
        .single();

      if (prodErr) {
        console.error("[generate-plan] Product insert failed:", prodErr.message, prodErr.details);
        throw new Error("Failed to save product: " + prodErr.message);
      }
      productIds.push(newProd?.id || "");
      if (newProd?.id) productIdByName.set(key, newProd.id);
    }

    // 7c. Get or create initiative types for each channel
    const channelTypeMap = new Map<string, string>();
    const { data: existingTypes } = await supabase
      .from("initiative_types")
      .select("id, channel")
      .eq("is_active", true);

    for (const t of existingTypes || []) {
      channelTypeMap.set(t.channel, t.id);
    }

    // 7d. Insert initiatives and their tasks
    // Sequence the whole set BEFORE writing any of it. The AI dates each
    // initiative without knowing about the others, so unsequenced output puts
    // several launches on the same day with their preparation windows stacked -
    // a pile-up rather than a plan. sequenceEventDates guarantees distinct
    // launch days, non-overlapping prep windows, each initiative's own runway,
    // and nothing in the past, all derived from the plan's own task leads.
    // Trial accounts are not trimmed specially: a trial grants Starter's limits,
    // and max_initiatives is enforced through the normal entitlement path like
    // any plan. The separate trial cap was removed.
    const generatedInitiatives = plan.initiatives || [];

    // Task templates for everything the model selected. Tasks and their lead
    // times come from here, not from the model.
    const selectedKeys = generatedInitiatives.map((gi) => gi.libraryKey || "").filter(Boolean);
    const templatesByKey = await loadTaskTemplates(supabase, selectedKeys);
    const unknownKeys = selectedKeys.filter((k) => !libraryKeys.has(k));
    if (unknownKeys.length > 0) {
      console.error("[generate-plan] Model returned keys not in the library:", unknownKeys.join(", "));
    }
    const missingTemplates = [...new Set(selectedKeys)].filter((k) => !templatesByKey.has(k));
    if (missingTemplates.length > 0) {
      console.warn("[generate-plan] No workbook task template for:", missingTemplates.join(", "));
    }
    const schedule = sequenceEventDates(
      generatedInitiatives.map((gi) => {
        const c = planMonthToCalendar(startYear, startMonth, gi.activationMonth || 1);
        const day = clampDayOfMonth(c.year, c.month, gi.eventDay ?? 15);
        return {
          desiredEvent: new Date(c.year, c.month - 1, day),
          // Authored runway beats inferred: the workbook says how long this
          // initiative takes to prepare. Falls back to the model's own task
          // leads only when the workbook has no template for it.
          runwayDays: templateRunwayDays(templatesByKey.get(gi.libraryKey || "") || [])
            || requiredRunwayDays(gi.tasks),
          // Evergreen work is continuous, not a launch, so it neither blocks
          // another initiative nor gets pushed by one.
          exclusive: gi.kind !== "evergreen",
        };
      }),
      { now }
    );
    const movedCount = schedule.filter((x) => x.adjusted).length;
    if (movedCount > 0) {
      console.log("[generate-plan] Re-sequenced", movedCount, "of", schedule.length, "initiatives to avoid overlap");
    }

    for (let initIdx = 0; initIdx < generatedInitiatives.length; initIdx++) {
      const init = generatedInitiatives[initIdx];
      const productId = productIds[init.productIndex] || productIds[0] || null;
      if (!productId) continue;

      // The workbook library key IS the channel now that the two are aligned.
      // `channel` is only read as a fallback for an older cached response.
      const channel = init.libraryKey || init.channel || "custom";

      let typeId = channelTypeMap.get(channel);
      if (!typeId) {
        // No initiative_type row for this library entry yet - create one from the
        // workbook so the library stays the source of truth rather than a
        // hand-maintained list. Difficulty is the workbook's 1-5 scale.
        const libDifficulty = libraryByKey.get(channel)?.difficulty ?? 3;
        const { data: newType } = await supabase
          .from("initiative_types")
          .insert({
            name: libraryByKey.get(channel)?.name
              || channel.charAt(0).toUpperCase() + channel.slice(1),
            channel,
            description: libraryByKey.get(channel)?.oneLiner || "",
            owner: "system",
            benchmarks: {},
            project_template: { tasks: [], totalEstimatedHours: 0 },
            difficulty: {
              effortToImplement: libDifficulty,
              skillExpertiseRequired: libDifficulty,
              timeToResults: libDifficulty,
              costToRun: libDifficulty,
            },
            ai_context: {},
            tier: 1,
            display_order: 99,
            is_active: true,
          })
          .select("id")
          .single();

        typeId = newType?.id;
        if (typeId) channelTypeMap.set(channel, typeId);
      }

      if (!typeId) continue;

      // Dates come from the sequenced schedule above, not from the raw AI output.
      const slot = schedule[initIdx];
      // Activation is the start of the month the initiative runs in; the EVENT
      // is the day it actually happens. The event day used to be hardcoded to
      // the 15th, so every task hung off a placeholder rather than the real
      // date. Clamped so a model-supplied 31 is valid in a 30-day month.
      // toDateOnly (not toISOString) so the local calendar day is preserved.
      // Activation is the start of the preparation window (event minus the
      // runway its tasks require), never earlier than today.
      const activationDateObj = slot.activationDate;
      const eventDateObj = slot.eventDate;
      const activationDate = toDateOnly(activationDateObj);
      const eventDate = toDateOnly(eventDateObj);

      const { data: newInit, error: initErr } = await supabase
        .from("initiatives")
        .insert({
          company_id: companyId,
          annual_plan_id: annualPlan.id,
          product_id: productId,
          initiative_type_id: typeId,
          name: init.name,
          description: init.description || "",
          kind: ["one-time", "recurring", "evergreen"].includes(init.kind) ? init.kind : "one-time",
          status: "planned",
          activation_date: activationDate,
          event_date: eventDate,
          traffic_input: init.trafficInput || null,
          revenue_good: init.revenueGood || 0,
          revenue_better: init.revenueBetter || 0,
          revenue_best: init.revenueBest || 0,
          planned_budget: init.plannedBudget || 0,
          actual_spend: 0,
          display_order: 0,
        })
        .select("id")
        .single();

      if (initErr) {
        console.error("[generate-plan] Initiative insert failed:", initErr.message, "| details:", initErr.details, "| hint:", initErr.hint);
        throw new Error("Failed to save initiative: " + initErr.message);
      }
      if (!newInit) continue;

      // Tasks come from the workbook's authored template for this initiative,
      // including the lead time for each one. Previously the model invented both.
      const templates = templatesByKey.get(init.libraryKey || "") || [];
      // The workbook wins where it has been authored. Where it has not, the
      // model's own task list is used rather than saving an initiative with no
      // project plan at all - both go through identical date handling.
      const tasks = templates.length > 0
        ? materialiseTasks(templates, { eventDate: eventDateObj, floor: planFloor })
        : materialiseAiTasks(init.tasks, { eventDate: eventDateObj, floor: planFloor });
      if (templates.length === 0) {
        console.log("[generate-plan] No workbook template for", init.libraryKey || init.name, "- used", tasks.length, "AI-suggested tasks");
      }
      if (tasks.length > 0) {
        const { error: taskErr } = await supabase.from("tasks").insert(
          tasks.map((t) => ({
            id: t.id,
            initiative_id: newInit.id,
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
        if (taskErr) {
          console.error("[generate-plan] Task insert failed:", taskErr.message);
          throw new Error("Failed to save tasks: " + taskErr.message);
        }
      }
    }

    // 7e. Insert projections.
    //     Replace, don't append: generation used to only INSERT, so every
    //     regeneration stacked another good/better/best set on top of the old
    //     ones (one company reached 10 rows where 3 are correct). Clearing the
    //     company's projections first makes generation idempotent.
    if (plan.monthlyProjections) {
      const { error: clearProjErr } = await supabase
        .from("projections")
        .delete()
        .eq("company_id", companyId)
        .eq("annual_plan_id", annualPlan.id);
      if (clearProjErr) {
        console.error("[generate-plan] Failed to clear old projections:", clearProjErr.message);
      } else {
        console.log("[generate-plan] Cleared previous projections before insert");
      }

      const scenarios = ["good", "better", "best"] as const;
      for (const scenario of scenarios) {
        // Claude may return an array directly or a nested object - normalize.
        let rawScenario = plan.monthlyProjections[scenario];
        if (rawScenario && !Array.isArray(rawScenario)) {
          // Handle cases like { monthly: [...] } or { revenues: [...] }
          rawScenario = rawScenario.monthly || rawScenario.revenues || Object.values(rawScenario).find(Array.isArray) || [];
        }
        const scenarioArr: number[] = Array.isArray(rawScenario) ? rawScenario : [];

        const monthly = scenarioArr.map((rev: number, idx: number) => {
          const pc = planMonthToCalendar(startYear, startMonth, idx + 1);
          const mOffset = pc.month - 1; // 0-indexed
          const mYear = pc.year;
          return {
            year: mYear,
            month: mOffset + 1,
            revenue: typeof rev === "number" ? rev : 0,
          };
        });

        const total = scenarioArr.reduce((s: number, v: number) => s + (typeof v === "number" ? v : 0), 0);
        const byProduct = productIds.map((pid) => ({
          productId: pid,
          revenue: Math.round(total / Math.max(productIds.length, 1)),
        }));

        await supabase.from("projections").insert({
          company_id: companyId,
          annual_plan_id: annualPlan.id,
          scenario,
          period: "monthly",
          by_product: byProduct,
          by_initiative: [],
          monthly,
        });
      }
    }

    // 7f. Update company-level revenue targets + financials.
    //     Only for the CURRENT year. The `companies` row holds the live
    //     targets; a future-year generation must not overwrite them (its
    //     figures live on that year's annual_plans row, updated in 7a).
    if (!targetYear) {
      await supabase
        .from("companies")
        .update({
          target_revenue: questionnaire.annualRevenueGoal || 0,
          prior_year_revenue: questionnaire.priorYearRevenue || 0,
          baseline_revenue: plan.annualPlan?.baselineRevenue || 0,
          stretch_revenue: plan.annualPlan?.stretchRevenue || 0,
          operating_budget: plan.annualPlan?.operatingBudget || 0,
          description: questionnaire.idealCustomer || "",
        })
        .eq("id", companyId);
    }

    // 7g. Log this generation event for admin metrics + activity feed.
    //     Goes through the service-role writer: the user-scoped insert that
    //     used to live here was rejected by RLS (42501) on every single run,
    //     silently, which is why generation_events was empty.
    await logGenerationEvent({
      companyId,
      userId: check.userId,
      eventType,
      status: "success",
      initiativesCreated: (plan.initiatives || []).length,
      durationMs,
      model: MODEL,
      tokensInput,
      tokensOutput,
    });

    // Meter the generation now that it has actually succeeded. Deliberately not
    // before the Claude call: a failed or timed-out run must not consume an
    // allowance the customer never got value from. recordUsage never throws, so
    // a metering fault cannot turn this success into an error.
    await recordUsage(
      billingDb,
      companyId,
      LIMIT_KEYS.AI_USES_MONTH,
      entitlement.period
    );

    return NextResponse.json({
      success: true,
      productsCreated: productIds.length,
      initiativesCreated: generatedInitiatives.length,
    });
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      message?: string;
      name?: string;
      error?: { type?: string; error?: { type?: string } };
    } | null;

    // Record the failure. Previously a failed generation left no trace at all,
    // so the dashboard could not distinguish "nobody generated" from "every
    // generation is crashing". Guarded on eventCompanyId: if we failed before
    // authorization resolved, there is no company to attribute it to.
    if (eventCompanyId) {
      await logGenerationEvent({
        companyId: eventCompanyId,
        userId: eventUserId,
        eventType,
        status: "failed",
        errorMessage: String(e?.message || "Internal error").slice(0, 500),
        model: MODEL,
      });
    }

    /**
     * Translate provider failures into something a customer can act on.
     *
     * This previously handled only an invalid API key and let everything else
     * fall through, returning the raw SDK message with a 500. An exhausted
     * credit balance therefore reached the screen as provider JSON including a
     * request id — an operator's billing problem presented as a crash.
     *
     * classifyAiFailure is unit-tested, and notably separates "out of credit"
     * from "malformed request": both arrive as a 400 invalid_request_error and
     * only the message distinguishes them.
     */
    const failure = classifyAiFailure(err);

    console.error(
      "[generate-plan] Failed (", failure.kind, ") |",
      aiFailureLogDetail(err), "| model:", MODEL
    );

    // Loud, actionable line for whoever has to fix the account. Separate from
    // the customer message by design.
    const hint = operatorHint(failure.kind);
    if (hint) console.error("[generate-plan]", hint);

    return NextResponse.json(
      { error: failure.message, kind: failure.kind, retryable: failure.retryable },
      { status: failure.status }
    );
  }
}
