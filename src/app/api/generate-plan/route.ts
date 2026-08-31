import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Claude needs more than the default serverless budget to produce a full plan.
export const maxDuration = 60;

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
`;
}

export async function POST(request: Request) {
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

    // 3. Get annual plan
    const { data: annualPlan } = await supabase
      .from("annual_plans")
      .select("id")
      .eq("company_id", companyId)
      .order("year", { ascending: false })
      .limit(1)
      .single();

    if (!annualPlan) {
      return NextResponse.json({ error: "No annual plan found" }, { status: 400 });
    }

    // 4. Parse questionnaire data from request body
    const body = await request.json();
    const questionnaire = body.questionnaire;

    if (!questionnaire) {
      return NextResponse.json({ error: "Missing questionnaire data" }, { status: 400 });
    }

    // 5. Call Claude
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set on the server." },
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
    const startMonth = now.getMonth() + 1; // 1-indexed
    const startYear = now.getFullYear();

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
              (benchmarks.conservative ? `  Benchmarks: conservative=${JSON.stringify(benchmarks.conservative)}, moderate=${JSON.stringify(benchmarks.moderate)}, aggressive=${JSON.stringify(benchmarks.aggressive)}\n` : "") +
              `  Difficulty: effort=${diff.effortToImplement || 5}/10, skill=${diff.skillExpertiseRequired || 5}/10, time-to-results=${diff.timeToResults || 5}/10, cost=${diff.costToRun || 5}/10`;
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
        const sheetSummaries = sheets.slice(0, 5).map((sheet: any) => {
          const maxRows = 20; // Cap rows to avoid blowing the prompt
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
      } else {
        console.log("[generate-plan] No workbook data found");
      }
    } catch (err) {
      console.log("[generate-plan] Failed to load workbook (table may not exist):", err);
    }

    const systemPrompt = buildSystemPrompt(startMonth, planMonths, startYear) + initiativeTypesContext + workbookContext;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

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

    // 7b. Insert products from the user's questionnaire (not AI-generated)
    const productIds: string[] = [];
    const userProducts = questionnaire.products || [];
    for (let i = 0; i < userProducts.length; i++) {
      const prod = userProducts[i];
      const isRecurring = prod.type === "membership" || prod.type === "subscription" || prod.type === "coaching";
      const price = prod.price || 0;
      const tier = price >= 2000 ? "high" : price >= 500 ? "mid" : "low";
      const { data: newProd } = await supabase
        .from("products")
        .insert({
          company_id: companyId,
          name: prod.name || "Untitled Product",
          description: "",
          price,
          revenue_type: isRecurring ? "recurring" : "one-time",
          ticket_tier: tier,
          is_active: true,
          display_order: i,
        })
        .select("id")
        .single();

      productIds.push(newProd?.id || "");
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

      const { data: newInit } = await supabase
        .from("initiatives")
        .insert({
          company_id: companyId,
          annual_plan_id: annualPlan.id,
          product_id: productId,
          initiative_type_id: typeId,
          name: init.name,
          description: init.description || "",
          kind: init.kind || "one-time",
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

    // 7e. Insert projections
    if (plan.monthlyProjections) {
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

    // 7f. Update company revenue targets + plan financials
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

    return NextResponse.json({ success: true, productsCreated: productIds.length, initiativesCreated: (plan.initiatives || []).length });
  } catch (err: any) {
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
