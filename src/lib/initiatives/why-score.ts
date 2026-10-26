/**
 * The FIT/SCORE card under "Why This Initiative"
 * (src/components/initiatives/initiative-why.tsx), and the response shape of
 * GET /api/initiatives/[id]/ai-context.
 *
 * The score comes from the initiative's workbook library row. It is computed
 * with the same scoreInitiative used by the intake recommendations, so the two
 * screens can never show different numbers for the same initiative: the total
 * is recomputed from the five scores (the stored score_total is ignored) and a
 * blank or invalid score counts as NEUTRAL_SCORE and marks the score
 * provisional.
 *
 * Pure: no I/O.
 */
import { SCORE_LETTERS, scoreInitiative, type ScoreBreakdown, type ScoreLetter } from "@/lib/recommend/score";
import type { ContextEntry, LibraryScores } from "@/lib/workbook/read";

export interface WhyScore {
  /** S+C+O+R+E, missing ones counted as NEUTRAL_SCORE. 5-25. */
  total: number;
  /** 25. */
  max: number;
  breakdown: ScoreBreakdown;
  /** False when any score was missing. */
  complete: boolean;
  missing: ScoreLetter[];
}

export interface AiContextResponse {
  entry: ContextEntry | null;
  score: WhyScore | null;
}

/**
 * The score to show, or null to hide the card: no library row, or not one of
 * the five scores usable (five neutral 3s would be a 15 that means nothing).
 */
export function whyScore(row: Partial<LibraryScores> | null | undefined): WhyScore | null {
  if (!row) return null;
  const s = scoreInitiative({
    name: "",
    speedScore: row.speedScore,
    costScore: row.costScore,
    oddsScore: row.oddsScore,
    revenueScore: row.revenueScore,
    easeScore: row.easeScore,
  });
  if (s.missing.length >= SCORE_LETTERS.length) return null;
  return { total: s.total, max: s.max, breakdown: s.breakdown, complete: s.complete, missing: s.missing };
}

/** The route's 200 body. */
export function aiContextResponse(
  entry: ContextEntry | null | undefined,
  scores: Partial<LibraryScores> | null | undefined
): AiContextResponse {
  return { entry: entry ?? null, score: whyScore(scores) };
}
