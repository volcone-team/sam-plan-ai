import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Claude needs more than the default serverless budget to produce a full plan.
// NOTE: Vercel Hobby caps functions at 10s regardless of this value; Pro honours it.
export const maxDuration = 300;

// Model is env-overridable so it can be rotated without a code change.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

// ------------------------------------------------------------------
// POST /api/generate-plan
// Accepts questionnaire answers, calls Claude to generate a revenue
// plan, then persists products/initiatives/projections/tasks to the
// user's company in Supabase.
// ------------------------------------------------------------------

function buildSystemPrompt(startMonth: number, planMonths: number, startYear: number): string {
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
      "channel": "webinar" | "email" | "linkedin" | "referral" | "challenge" | "vsl" | "paid_ads" | "sales_calls" | "content_social" | "custom",
      "activationMonth": number (1-${planMonths}),
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
          "daysBeforeEvent": number,
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
- Keep output COMPACT: max 4 tasks per initiative, short descriptions (one sentence). Do not add fields beyond the schema.
`;
}

export async function POST(request: Request) {
  console.log("[generate-plan] === Request received ===");
  try {
    // 1. Auth check
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Get user profile + company
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      return NextResponse.json({ error: "No company found" }, { status: 400 });
    }

    const companyId = profile.company_id;

    // 3. Parse the request body first - we need targetYear to resolve the plan.
    const body = await request.json();
    const questionnaire = body.questionnaire;
    const targetYear: number | undefined =
      typeof body.targetYear === "number" && body.targetYear > 2000 ? body.targetYear : undefined;

    if (!questionnaire) {
      return NextResponse.json({ error: "Missing questionnaire data" }, { status: 400 });
    }

    // 4. Resolve the annual plan to generate into.
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
${(questionnaire.products || []).map((p: any) => `- ${p.name} (${p.type}, $${p.price})`).join("\n") || "None specified"}

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
    // A future-year plan runs the full calendar year (Jan). The current year
    // starts from the current month, as before.
    const startMonth = targetYear ? 1 : now.getMonth() + 1; // 1-indexed
    const startYear = targetYear ?? now.getFullYear();

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
          initTypes.map((t: any) => {
            const benchmarks = t.benchmarks || {};
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
    let workbookContext = "";
    try {
      const { data: workbook } = await supabase
        .from("workbook_data")
        .select("sheets, file_name")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .single();

      if (workbook && workbook.sheets) {
        console.log("[generate-plan] Loaded workbook:", workbook.file_name, "| sheets:", (workbook.sheets as any[]).length);
        const sheets = workbook.sheets as any[];
        // Inject each sheet as context (limit to avoid token overflow)
        const sheetSummaries = sheets.slice(0, 3).map((sheet: any) => {
          const maxRows = 8; // Keep the prompt small - large context made generation exceed the time limit
          const rows = (sheet.rows || []).slice(0, maxRows);
          const headers = sheet.headers || [];
          let table = `Sheet: "${sheet.name}" (${sheet.rowCount || rows.length} rows)\n`;
          table += `Headers: ${headers.join(" | ")}\n`;
          rows.forEach((row: string[]) => {
            table += row.join(" | ") + "\n";
          });
          if ((sheet.rows || []).length > maxRows) {
            table += `... (${(sheet.rows || []).length - maxRows} more rows)\n`;
          }
          return table;
        });

        workbookContext = "\n\nADMIN WORKBOOK DATA (use this as grounding data for benchmarks, conversion rates, and context):\n" +
          sheetSummaries.join("\n---\n");
        // Hard cap so a large workbook can never blow up generation time.
        const WORKBOOK_CHAR_CAP = 4000;
        if (workbookContext.length > WORKBOOK_CHAR_CAP) {
          workbookContext = workbookContext.slice(0, WORKBOOK_CHAR_CAP) + "\n... (workbook truncated)";
        }
        console.log("[generate-plan] Workbook context:", workbookContext.length, "chars");
      } else {
        console.log("[generate-plan] No workbook data found");
      }
    } catch (err) {
      console.log("[generate-plan] Failed to load workbook (table may not exist):", err);
    }

    const systemPrompt = buildSystemPrompt(startMonth, planMonths, startYear) + initiativeTypesContext + workbookContext;

    console.log("[generate-plan] System prompt size:", systemPrompt.length, "chars");
    const claudeStart = Date.now();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    console.log(
      "[generate-plan] Claude responded in", Date.now() - claudeStart, "ms",
      "| stop_reason:", response.stop_reason,
      "| output tokens:", response.usage?.output_tokens
    );
    if (response.stop_reason === "max_tokens") {
      console.error("[generate-plan] Output hit the token cap - JSON likely truncated");
    }

    // 6. Parse Claude's response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let plan: any;
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
    for (const init of plan.initiatives || []) {
      const productId = productIds[init.productIndex] || productIds[0] || null;
      if (!productId) continue;

      let typeId = channelTypeMap.get(init.channel);
      if (!typeId) {
        // Create a custom type for unknown channels
        const { data: newType } = await supabase
          .from("initiative_types")
          .insert({
            name: init.channel.charAt(0).toUpperCase() + init.channel.slice(1),
            channel: init.channel,
            description: "",
            owner: "system",
            benchmarks: {},
            project_template: { tasks: [], totalEstimatedHours: 0 },
            difficulty: { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
            ai_context: {},
            tier: 1,
            display_order: 99,
            is_active: true,
          })
          .select("id")
          .single();

        typeId = newType?.id;
        if (typeId) channelTypeMap.set(init.channel, typeId);
      }

      if (!typeId) continue;

      // Calculate activation date relative to the current month
      const activationOffset = (init.activationMonth || 1) - 1; // 0-indexed offset
      const actualMonth = ((startMonth - 1) + activationOffset) % 12; // 0-indexed month
      const actualYear = startYear + Math.floor(((startMonth - 1) + activationOffset) / 12);
      const activationDate = new Date(actualYear, actualMonth, 1).toISOString().split("T")[0];
      const eventDate = new Date(actualYear, actualMonth, 15).toISOString().split("T")[0];

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

      // Insert tasks for this initiative
      for (let i = 0; i < (init.tasks || []).length; i++) {
        const task = init.tasks[i];
        const dueDate = new Date(actualYear, actualMonth, 15 + (task.daysBeforeEvent || 0));
        const dueDateStr = dueDate.toISOString().split("T")[0];

        await supabase.from("tasks").insert({
          initiative_id: newInit.id,
          company_id: companyId,
          name: task.name,
          description: task.description || "",
          due_date: dueDateStr,
          estimated_hours: task.estimatedHours || 2,
          status: "not_started",
          priority: task.priority || "medium",
          display_order: i,
          dependency_ids: [],
        });
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
          const mOffset = ((startMonth - 1) + idx) % 12; // 0-indexed
          const mYear = startYear + Math.floor(((startMonth - 1) + idx) / 12);
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
    //     Non-fatal: if the table doesn't exist yet, we just skip it.
    try {
      await supabase.from("generation_events").insert({
        company_id: companyId,
        user_id: user.id,
        event_type: "plan_generation",
        initiatives_created: (plan.initiatives || []).length,
        model: MODEL,
      });
    } catch (logErr) {
      console.log("[generate-plan] generation_events log skipped:", logErr);
    }

    return NextResponse.json({ success: true, productsCreated: productIds.length, initiativesCreated: (plan.initiatives || []).length });
  } catch (err: any) {
    // Surface auth failures against the AI provider in plain language, since
    // an invalid/expired key is by far the most common cause of failure here.
    const isAuthError =
      err?.status === 401 ||
      err?.error?.error?.type === "authentication_error" ||
      String(err?.message || "").includes("API key is invalid");

    if (isAuthError) {
      console.error("[generate-plan] Anthropic rejected the API key (401). Set a valid ANTHROPIC_API_KEY.");
      return NextResponse.json(
        {
          error:
            "The AI service rejected our API key. Please set a valid ANTHROPIC_API_KEY on the server and try again.",
          status: 401,
          type: "authentication_error",
          model: MODEL,
        },
        { status: 500 }
      );
    }

    const detail = {
      error: err?.message || "Internal error",
      status: err?.status,
      type: err?.error?.type ?? err?.name,
      model: MODEL,
    };
    console.error("[generate-plan] Error:", detail);
    return NextResponse.json(detail, { status: 500 });
  }
}
