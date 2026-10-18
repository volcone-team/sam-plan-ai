/**
 * SCORE — the second half of the client's "FIT, then SCORE" methodology.
 *
 * FIT (eligibility.ts) removes initiatives that cannot work for a business.
 * Everything that survives is ranked here on five workbook scores, each 1-5
 * where 5 is ALWAYS the desirable end:
 *
 *   S  Speed    how soon it produces revenue
 *   C  Cost     how cheap it is to run
 *   O  Odds     how likely it is to work
 *   R  Revenue  how much revenue it can produce
 *   E  Ease     how easy it is to run
 *
 * The plain total is S+C+O+R+E (5-25). The methodology also allows an optional
 * Revenue weight — the doc's working value is 2, counting R double for a max of
 * 30 — and says to keep both totals until data decides. The app needs ONE live
 * ranking, so the order uses `weightedTotal` with an admin-chosen weight
 * (default 1, i.e. the plain total) and both figures are always reported.
 *
 * THE ORDER IS OURS, NOT THE AI'S. Claude is given this ranked shortlist and
 * asked to explain it; it never reorders it. The fallback path uses the same
 * function, so the order is identical with and without the AI.
 *
 * Pure and deterministic: no I/O, never throws, same input gives same output.
 */

/** The five score letters, in methodology order. */
export const SCORE_LETTERS = ["S", "C", "O", "R", "E"] as const;
export type ScoreLetter = (typeof SCORE_LETTERS)[number];

/** Lowest and highest valid value of one score. */
export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

/**
 * What a MISSING score counts as for ordering: the midpoint of 1-5.
 *
 * A blank cell is "we don't know", not "worst" and not "best". Treating it as
 * 1 would bury every partly-scored initiative beneath fully-scored weak ones;
 * treating it as 5 would let a blank row outrank a measured strong one. The
 * neutral 3 keeps it in the middle of the field, `complete: false` flags it,
 * and on an equal total a complete row is ranked first (see compareScored).
 */
export const NEUTRAL_SCORE = 3;

/** Revenue weight bounds. 1 = equal weight (max 25); 2 = R counts double (max 30). */
export const DEFAULT_REVENUE_WEIGHT = 1;
export const MIN_REVENUE_WEIGHT = 1;
export const MAX_REVENUE_WEIGHT = 3;
export const REVENUE_WEIGHT_STEP = 0.5;

/** The fields read. LibraryEntry and LibraryInitiative both satisfy this. */
export interface ScoreInput {
  name: string;
  speedScore?: number | null;
  costScore?: number | null;
  oddsScore?: number | null;
  revenueScore?: number | null;
  easeScore?: number | null;
}

export interface ScoreOptions {
  /** Multiplier on R. Normalised with normaliseRevenueWeight. */
  revenueWeight?: number;
}

export type ScoreBreakdown = Record<ScoreLetter, number>;

export interface InitiativeScore {
  /** S+C+O+R+E with missing scores counted as NEUTRAL_SCORE. 5-25. */
  total: number;
  /** S+C+O+E + R x weight. Equal to `total` at weight 1. This is what ranks. */
  weightedTotal: number;
  /** 25. */
  max: number;
  /** 20 + 5 x weight (25 at weight 1, 30 at weight 2). */
  weightedMax: number;
  /** False when any of the five scores is missing or invalid. */
  complete: boolean;
  /** The values used, missing ones already replaced by NEUTRAL_SCORE. */
  breakdown: ScoreBreakdown;
  /** Which letters were missing (and so counted as NEUTRAL_SCORE). */
  missing: ScoreLetter[];
}

/**
 * The weight as a usable number: 1-3 in steps of 0.5.
 *
 * Anything unusable (null, NaN, a string, out of range) becomes the default
 * rather than an error, because a bad setting must never stop recommendations.
 * In-range values are snapped to the nearest step.
 */
export function normaliseRevenueWeight(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < MIN_REVENUE_WEIGHT || n > MAX_REVENUE_WEIGHT) {
    return DEFAULT_REVENUE_WEIGHT;
  }
  return Math.round(n / REVENUE_WEIGHT_STEP) * REVENUE_WEIGHT_STEP;
}

/**
 * A weight exactly as given, or null when it is not 1-3 in steps of 0.5.
 * STRICT, for the admin API: a bad value is refused, not snapped.
 */
export function parseRevenueWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_REVENUE_WEIGHT || value > MAX_REVENUE_WEIGHT) return null;
  const steps = value / REVENUE_WEIGHT_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-9 ? value : null;
}

/** True for a whole number 1-5. Anything else is treated as missing. */
function validScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}

/**
 * Score one initiative.
 *
 * Totals are always recomputed from the five scores rather than read from the
 * stored `score_total`, so the ranking can never disagree with the breakdown
 * shown beside it.
 */
export function scoreInitiative(initiative: ScoreInput, opts: ScoreOptions = {}): InitiativeScore {
  const weight = normaliseRevenueWeight(opts.revenueWeight ?? DEFAULT_REVENUE_WEIGHT);
  const raw: Record<ScoreLetter, number | null | undefined> = {
    S: initiative.speedScore,
    C: initiative.costScore,
    O: initiative.oddsScore,
    R: initiative.revenueScore,
    E: initiative.easeScore,
  };

  const missing: ScoreLetter[] = [];
  const breakdown = {} as ScoreBreakdown;
  for (const letter of SCORE_LETTERS) {
    const value = raw[letter];
    if (validScore(value)) {
      breakdown[letter] = value;
    } else {
      breakdown[letter] = NEUTRAL_SCORE;
      missing.push(letter);
    }
  }

  const total = breakdown.S + breakdown.C + breakdown.O + breakdown.R + breakdown.E;
  return {
    total,
    weightedTotal: total - breakdown.R + breakdown.R * weight,
    max: MAX_SCORE * SCORE_LETTERS.length,
    weightedMax: MAX_SCORE * (SCORE_LETTERS.length - 1) + MAX_SCORE * weight,
    complete: missing.length === 0,
    breakdown,
    missing,
  };
}

export interface ScoredInitiative<T> {
  initiative: T;
  score: InitiativeScore;
  /** 1-based position in the ranking. */
  rank: number;
}

/** Plain code-point order of the lower-cased name: locale-independent. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The ranking order. Earlier keys decide; later ones only break ties.
 *
 *   1. weighted total, high first
 *   2. complete scores before incomplete ones (an equal total built on a
 *      guessed 3 is weaker evidence than a measured one)
 *   3. Odds, high first     — likelihood of working is the safest tie-break
 *   4. Revenue, high first
 *   5. Ease, high first
 *   6. name A-Z, then key/raw name — a total order, so the sort is stable
 *      whatever order the rows arrive in.
 */
function compareScored<T extends ScoreInput & { key?: string; initiativeKey?: string }>(
  a: { initiative: T; score: InitiativeScore },
  b: { initiative: T; score: InitiativeScore }
): number {
  return (
    b.score.weightedTotal - a.score.weightedTotal ||
    Number(b.score.complete) - Number(a.score.complete) ||
    b.score.breakdown.O - a.score.breakdown.O ||
    b.score.breakdown.R - a.score.breakdown.R ||
    b.score.breakdown.E - a.score.breakdown.E ||
    compareText(a.initiative.name.trim().toLowerCase(), b.initiative.name.trim().toLowerCase()) ||
    compareText(identity(a.initiative), identity(b.initiative)) ||
    compareText(a.initiative.name, b.initiative.name)
  );
}

function identity(i: { key?: string; initiativeKey?: string }): string {
  return i.key ?? i.initiativeKey ?? "";
}

/** Rank with the score and position attached. Does not mutate the input. */
export function scoreAndRank<T extends ScoreInput & { key?: string; initiativeKey?: string }>(
  initiatives: readonly T[],
  opts: ScoreOptions = {}
): ScoredInitiative<T>[] {
  return initiatives
    .map((initiative) => ({ initiative, score: scoreInitiative(initiative, opts) }))
    .sort(compareScored)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** The initiatives, best first. Does not mutate the input. */
export function rankByScore<T extends ScoreInput & { key?: string; initiativeKey?: string }>(
  initiatives: readonly T[],
  opts: ScoreOptions = {}
): T[] {
  return scoreAndRank(initiatives, opts).map((entry) => entry.initiative);
}
