/**
 * The Enhance Plan prompt: the system prompt and the plan summary sent to the
 * model by POST /api/plan/enhance. Kept out of the route so it can be tested.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ENHANCE_SYSTEM_PROMPT = `You are SAM Plan AI, a strategic revenue planning assistant.

You are given a business's CURRENT revenue plan (products, initiatives, targets).
Your job is to suggest IMPROVEMENTS — you are NOT rewriting the plan.

Return ONLY valid JSON (no markdown) in this exact shape:

{
  "suggestions": [
    {
      "type": "new_initiative" | "budget_change" | "date_change" | "product_update",
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
- The baseline and stretch revenue goals are fixed for the year. Never propose changing them.
  Aim your suggestions at reaching or beating those goals; the plan's forecast may exceed them.
- DATES MUST BE IN THE FUTURE. The CURRENT DATE and the PLAN YEAR are given below.
  Never propose a date in the past or in an earlier year — the work could not be
  done. Every activationMonth you return must fall on or after the current date
  and within the plan year.
- Use a full ISO date ("YYYY-MM-DD") for activationMonth, not a bare month
  number, so there is no ambiguity about which year you mean.
- new_initiative: propose "proposed" as { name, description, libraryKey, activationMonth, plannedBudget, revenueBetter, tasks }
  - libraryKey MUST be one of the key= values from the INITIATIVE LIBRARY below. Do not invent one.
  - tasks is a FALLBACK only: [{ name, description, daysBeforeEvent (positive), estimatedHours, priority }].
    Where the workbook has an authored task template for the chosen libraryKey it is used instead of yours.
- budget_change: "current" as { plannedBudget }, "proposed" as { plannedBudget }
- date_change: "current" as { activationMonth }, "proposed" as { activationMonth }
- product_update: "current" as { price? }, "proposed" as { price?, note? }
- Base suggestions on what's realistic for their budget, team, and what has worked.
- Every suggestion must be actionable and specific. No vague advice.
- Do NOT suggest deleting anything. Only additions and adjustments.
`;

type Money = number | string | null | undefined;

export interface PlanSummaryInput {
  today: string;
  planYear: number;
  company: {
    target_revenue?: Money;
    baseline_revenue?: Money;
    stretch_revenue?: Money;
    operating_budget?: Money;
  } | null | undefined;
  annualPlan: {
    baseline_revenue?: Money;
    stretch_revenue?: Money;
    operating_budget?: Money;
  } | null | undefined;
  products: { name: string; price: Money; revenue_type: string | null }[] | null | undefined;
  initiatives: any[];
}

/** The CURRENT PLAN message sent as the user turn of the enhance call. */
export function buildPlanSummary({
  today,
  planYear,
  company,
  annualPlan,
  products,
  initiatives,
}: PlanSummaryInput): string {
  return `CURRENT PLAN

CURRENT DATE: ${today}
PLAN YEAR: ${planYear}
EARLIEST ALLOWED DATE: ${today}
LATEST ALLOWED DATE: ${planYear}-12-31

Every date you propose must fall between the earliest and latest allowed dates
above. Anything earlier is in the past and cannot be executed.

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
}
