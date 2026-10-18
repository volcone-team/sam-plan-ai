/**
 * Wording for SCORE on the recommendations screen.
 *
 * Kept out of the components so the numbers and phrasing are tested. The
 * scores are expert ratings, not measurements, and the copy says so.
 *
 * Pure: no I/O.
 */

import {
  MAX_SCORE,
  NEUTRAL_SCORE,
  SCORE_LETTERS,
  normaliseRevenueWeight,
  type ScoreLetter,
} from "@/lib/recommend/score";

/** Each letter spelled out, with what a 5 means (from the workbook headers). */
export const SCORE_LABELS: Record<ScoreLetter, { label: string; best: string }> = {
  S: { label: "Speed", best: "5 = really fast" },
  C: { label: "Cost", best: "5 = low cost" },
  O: { label: "Odds", best: "5 = near certain" },
  R: { label: "Revenue", best: "5 = great" },
  E: { label: "Ease", best: "5 = easy" },
};

export const SCORE_NOTE = "Scores are our experts' ratings, 1 to 5, where 5 is always best.";

/** The plain maximum: 25. */
export const PLAIN_MAX = MAX_SCORE * SCORE_LETTERS.length;

/** 20 + 5 x weight: 25 at weight 1, 30 at weight 2. */
export function weightedMaxFor(weight: number): number {
  const w = normaliseRevenueWeight(weight);
  return MAX_SCORE * (SCORE_LETTERS.length - 1) + MAX_SCORE * w;
}

/** "×2", "×1.5". */
export function formatWeight(weight: number): string {
  return `×${normaliseRevenueWeight(weight)}`;
}

/** "21 / 25". */
export function formatTotal(total: number, max: number = PLAIN_MAX): string {
  return `${formatNumber(total)} / ${formatNumber(max)}`;
}

/**
 * "26 / 30 with Revenue weighted ×2", or null at weight 1, where the weighted
 * total is the plain total and saying it twice would only confuse.
 */
export function weightedTotalLabel(weightedTotal: number, weight: number): string | null {
  const w = normaliseRevenueWeight(weight);
  if (w === 1) return null;
  return `${formatTotal(weightedTotal, weightedMaxFor(w))} with Revenue weighted ${formatWeight(w)}`;
}

/** "Speed 5 of 5" — the text value for one bar. */
export function barLabel(letter: ScoreLetter, value: number, missing = false): string {
  const base = `${SCORE_LABELS[letter].label} ${formatNumber(value)} of ${MAX_SCORE}`;
  return missing ? `${base} (not scored yet, counted as ${NEUTRAL_SCORE})` : base;
}

/** "Speed and Odds aren't scored yet, so each was counted as 3." Null when nothing is missing. */
export function provisionalNote(missing: readonly ScoreLetter[]): string | null {
  const names = SCORE_LETTERS.filter((l) => missing.includes(l)).map((l) => SCORE_LABELS[l].label);
  if (names.length === 0) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return names.length === 1
    ? `${list} isn't scored yet, so it was counted as ${NEUTRAL_SCORE}.`
    : `${list} aren't scored yet, so each was counted as ${NEUTRAL_SCORE}.`;
}

/** "#1 of 33 that fit you"; "#1" when the pool size is unknown. */
export function rankLabel(rank: number, poolSize: number | null | undefined): string {
  if (typeof poolSize === "number" && Number.isFinite(poolSize) && poolSize >= rank && poolSize > 0) {
    return `#${rank} of ${poolSize} that fit you`;
  }
  return `#${rank}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * "SCORE 21" for a browse-list row; "SCORE 21*" when some letters were
 * guessed. Null when nothing is scored, because five neutral 3s add up to a
 * 15 that means nothing.
 */
export function browseScoreLabel(
  score: { total: number; missing: readonly string[] } | null | undefined
): string | null {
  if (!score || score.missing.length >= SCORE_LETTERS.length) return null;
  return `SCORE ${formatNumber(score.total)}${score.missing.length > 0 ? "*" : ""}`;
}
