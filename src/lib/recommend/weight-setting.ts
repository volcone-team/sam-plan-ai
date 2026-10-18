import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/workbook/read";
import { DEFAULT_REVENUE_WEIGHT, normaliseRevenueWeight } from "@/lib/recommend/score";

/**
 * The admin's Revenue weight for SCORE ranking (migration 041,
 * `app_settings.recommendation_revenue_weight`).
 *
 * NEVER FAILS: a missing column (041 not applied), a missing singleton row, an
 * unreadable table or an out-of-range value all give the default weight 1.
 * A ranking setting must not be able to stop recommendations, plan generation,
 * Enhance or chat.
 */
export async function loadRecommendationWeight(db: SupabaseClient): Promise<number> {
  const state = await readRecommendationWeight(db);
  return state.weight;
}

export interface RecommendationWeightState {
  weight: number;
  /** False when migration 041 has not been applied (column missing). */
  available: boolean;
}

/** As loadRecommendationWeight, also saying whether the column exists (for the admin screen). */
export async function readRecommendationWeight(db: SupabaseClient): Promise<RecommendationWeightState> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("recommendation_revenue_weight")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      if (!isMissingColumnError(error)) {
        console.error("[recommend/weight] read failed, using weight 1:", error.message);
      }
      return { weight: DEFAULT_REVENUE_WEIGHT, available: !isMissingColumnError(error) };
    }

    const raw = (data as { recommendation_revenue_weight?: unknown } | null)?.recommendation_revenue_weight;
    return { weight: normaliseRevenueWeight(raw ?? DEFAULT_REVENUE_WEIGHT), available: true };
  } catch (err: unknown) {
    console.error(
      "[recommend/weight] read threw, using weight 1:",
      err instanceof Error ? err.message : String(err)
    );
    return { weight: DEFAULT_REVENUE_WEIGHT, available: true };
  }
}
