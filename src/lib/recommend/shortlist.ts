/**
 * The recommendation pipeline after FIT, as pure functions so the route's
 * ordering guarantees can be tested without a server:
 *
 *   rankForRecommendation  eligible pool -> SCORE order, and the shortlist
 *                          (top `wanted` plus the swap reserve) to explain
 *   explainRanked          attach explanations; AI where valid, template
 *                          otherwise. ORDER IS NEVER CHANGED.
 */

import type { LibraryInitiative } from "@/lib/intake/library";
import type { ContextEntry } from "@/lib/workbook/read";
import { scoreAndRank, type ScoredInitiative } from "@/lib/recommend/score";
import { SWAP_RESERVE } from "@/lib/recommend/sizing";
import {
  mergeExplanations,
  templateExplanation,
  type ParsedExplanation,
  type RecommendationExplanation,
} from "@/lib/recommend/explain";

export interface RankedPool {
  /** Every eligible initiative, best first. */
  ranked: ScoredInitiative<LibraryInitiative>[];
  /** What is sent to the AI: the top `wanted`, then the swap reserve. */
  shortlist: ScoredInitiative<LibraryInitiative>[];
}

export function rankForRecommendation(
  pool: readonly LibraryInitiative[],
  opts: { revenueWeight: number; wanted: number; reserve?: number }
): RankedPool {
  const ranked = scoreAndRank(pool, { revenueWeight: opts.revenueWeight });
  const size = Math.max(0, opts.wanted) + Math.max(0, opts.reserve ?? SWAP_RESERVE);
  return { ranked, shortlist: opts.wanted > 0 ? ranked.slice(0, size) : [] };
}

export interface ExplainedInitiative extends ScoredInitiative<LibraryInitiative> {
  explanation: RecommendationExplanation;
}

export interface ExplainResult {
  /** Same entries and SAME ORDER as `ranked`. */
  items: ExplainedInitiative[];
  /** Model keys not on the shortlist (dropped). Empty without AI. */
  ignored: string[];
  /** Shortlisted keys that fell back to the template. All of them without AI. */
  filled: string[];
}

/**
 * Attach an explanation to every ranked initiative.
 *
 * `aiParsed` is null when the AI was unavailable: everything is templated.
 * Otherwise only SHORTLISTED keys may take the model's text; everything past
 * the shortlist (deeper swap alternatives) is templated because the model was
 * never asked about it.
 */
export function explainRanked(
  ranked: readonly ScoredInitiative<LibraryInitiative>[],
  shortlistKeys: readonly string[],
  aiParsed: readonly ParsedExplanation[] | null,
  contextByKey: ReadonlyMap<string, ContextEntry>
): ExplainResult {
  const byKey = new Map(ranked.map((r) => [r.initiative.key, r]));
  const template = (key: string): RecommendationExplanation => {
    const entry = byKey.get(key);
    // Only shortlisted keys reach here, and the shortlist is a slice of ranked.
    return entry
      ? templateExplanation(entry.initiative, entry.score, contextByKey.get(key))
      : { whyFits: "", whatToTrack: [], watchOutFor: null, readinessQuestions: [], source: "template" };
  };

  const merged = mergeExplanations(shortlistKeys, aiParsed ?? [], template);

  return {
    items: ranked.map((entry) => ({
      ...entry,
      explanation:
        merged.byKey.get(entry.initiative.key) ??
        templateExplanation(entry.initiative, entry.score, contextByKey.get(entry.initiative.key)),
    })),
    ignored: merged.ignored,
    filled: merged.filled,
  };
}
