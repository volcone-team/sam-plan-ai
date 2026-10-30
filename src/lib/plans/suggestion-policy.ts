/**
 * Which Enhance Plan suggestion types can be stored, listed and accepted.
 *
 * Revenue goals (baseline and stretch) are fixed for the year, so the old
 * "target_change" type is retired. Existing plan_suggestions rows of that type
 * stay in the database (the CHECK constraint still allows it) but are never
 * stored, listed or applied again.
 */

export const ENHANCE_SUGGESTION_TYPES = [
  "new_initiative",
  "budget_change",
  "date_change",
  "product_update",
] as const;

export type EnhanceSuggestionType = (typeof ENHANCE_SUGGESTION_TYPES)[number];

/** True for a suggestion that would change the baseline or stretch goals. */
export function isGoalChangeType(type: unknown): boolean {
  return type === "target_change";
}

/** True for a suggestion type Enhance Plan stores, lists and applies. */
export function isAcceptableSuggestionType(type: unknown): type is EnhanceSuggestionType {
  return (ENHANCE_SUGGESTION_TYPES as readonly unknown[]).includes(type);
}
