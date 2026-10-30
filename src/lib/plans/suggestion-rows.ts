/**
 * Enhance Plan suggestion rows: AI output -> plan_suggestions rows
 * (POST /api/plan/enhance), and plan_suggestions rows -> the client shape
 * (GET /api/plan/suggestions). Kept out of the routes so they can be tested.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAcceptableSuggestionType, isGoalChangeType } from "./suggestion-policy";

export interface BuildSuggestionRowsOptions {
  companyId: string;
  batchId: string;
  initiatives: { id: string; name: string }[] | null | undefined;
  products: { id: string; name: string }[] | null | undefined;
  passesFit: (s: { type?: unknown; proposed?: unknown }) => boolean;
}

/** Filters the AI's suggestions to the stored types and maps them to pending rows. */
export function buildSuggestionRows(
  suggestions: any[],
  { companyId, batchId, initiatives, products, passesFit }: BuildSuggestionRowsOptions
) {
  // Map AI targetName back to the real initiative/product id where possible
  const initByName = new Map((initiatives || []).map((i) => [i.name.toLowerCase(), i.id]));
  const prodByName = new Map((products || []).map((p) => [p.name.toLowerCase(), p.id]));

  return suggestions
    .filter((s: any) => {
      if (isAcceptableSuggestionType(s?.type)) return true;
      if (isGoalChangeType(s?.type)) {
        // Goals are fixed for the year; never store a proposal to change them.
        console.log("[enhance] dropped goal change suggestion:", s?.title ?? null);
      }
      return false;
    })
    .filter(passesFit)
    .map((s: any) => {
      const name = (s.targetName || "").toLowerCase();
      let targetId: string | null = null;
      if (s.type === "product_update") targetId = prodByName.get(name) || null;
      else if (s.type !== "new_initiative") targetId = initByName.get(name) || null;

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
}

/** Maps pending plan_suggestions rows to the shape the Enhance Plan page reads. */
export function toClientSuggestions(rows: any[] | null | undefined) {
  // Goal change rows stored before the fix stay in the database but are hidden.
  return (rows || []).filter((s) => !isGoalChangeType(s?.suggestion_type)).map((s) => ({
    id: s.id,
    batchId: s.batch_id,
    type: s.suggestion_type,
    targetId: s.target_id,
    targetLabel: s.target_label,
    title: s.title,
    rationale: s.rationale,
    current: s.current_value,
    proposed: s.proposed_value,
    status: s.status,
  }));
}
