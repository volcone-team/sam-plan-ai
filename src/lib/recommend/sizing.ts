/**
 * How many initiatives a plan may hold, and the stage ranges that describe it.
 *
 * TWO DIFFERENT THINGS LIVE HERE, and they used to be one:
 *
 *   MAX_RECOMMENDED_INITIATIVES / recommendationCapacity — the ENTITLEMENT. Five for everyone,
 *   whatever their stage or plan tier. This is what the screen enforces.
 *
 *   SIZES / sizeForStage / describeStageRange — ADVISORY ONLY, the stage
 *   ranges from REQ-13.13 (Start 1-2, Momentum 2-4, Scale 4-5). They describe
 *   what suits a business at each stage and no longer limit anything.
 *
 * The stage used to cap capacity, which meant a Start-stage business was shown
 * "0 of 2 selected" and could never reach the five the product offers. A stage
 * is a statement about ambition, not entitlement.
 *
 * Separated from the eligibility rules because it answers a different question:
 * eligibility is "could they run this", sizing is "how many may they have".
 */

export type Stage = "start" | "momentum" | "scale";

/**
 * The most initiatives a plan may ever contain.
 *
 * A HARD CEILING, applied after the stage budget and regardless of plan tier.
 * Scale was previously open-ended ("4 or more", capped only by the plan's
 * max_initiatives), which meant a customer on a large plan could be handed
 * eight or nine — more than anyone runs properly, which is the same failure the
 * stage budgets were written to prevent, just further up the range.
 *
 * This is the TOTAL in the plan, not the number of new recommendations: the
 * user's own initiatives count against it. That is what makes the
 * recommendations screen a choice of five rather than an ever-growing list.
 */
export const MAX_RECOMMENDED_INITIATIVES = 5;

/**
 * The fewest recommendations worth putting on the screen.
 *
 * Three, from the owner's "3-5 initiatives" rule. A shortlist of one or two is
 * not a choice, and the screen's whole job is to offer a choice — so the
 * shortlist shrinks to this and no further, even when that means holding back
 * fewer alternatives for swapping.
 *
 * Does not apply when the eligible pool is genuinely smaller: we cannot invent
 * a third candidate, and padding with something ineligible would be worse than
 * showing two.
 */
export const MIN_RECOMMENDED_INITIATIVES = 3;

/**
 * How many candidates to hold back from the shortlist so Swap has somewhere to go.
 *
 * Three, matching MIN_RECOMMENDED_INITIATIVES: enough that a user can reject
 * every card on screen once and still be looking at a full shortlist.
 *
 * This is a RESERVE, not a guarantee. When the pool is too small to both fill
 * the shortlist and hold three back, the shortlist wins and the reserve
 * shrinks — an empty screen is worse than a disabled button.
 */
export const SWAP_RESERVE = 3;

export interface StageSize {
  min: number;
  /** Null for Scale, which the spec leaves open-ended. */
  max: number | null;
  /** What to aim for when there is enough gap to justify it. */
  target: number;
}

/**
 * ADVISORY RANGES ONLY — recommendationCapacity does not consult these.
 *
 * They remain the honest description of what suits a business at each stage,
 * for copy that wants to say so. `target` is no longer a cap.
 */
const SIZES: Record<Stage, StageSize> = {
  start: { min: 1, max: 2, target: 2 },
  momentum: { min: 2, max: 4, target: 3 },
  // Was "4 or more" and open-ended. Bounded by the ceiling so no range ever
  // describes a plan larger than one we will build.
  scale: { min: 4, max: MAX_RECOMMENDED_INITIATIVES, target: MAX_RECOMMENDED_INITIATIVES },
};

/** Fallback when stage is missing. */
const DEFAULT_STAGE: Stage = "momentum";

export function isStage(value: unknown): value is Stage {
  return value === "start" || value === "momentum" || value === "scale";
}

export function sizeForStage(stage: string | null | undefined): StageSize {
  return SIZES[isStage(stage) ? stage : DEFAULT_STAGE];
}

/**
 * The most initiatives this plan may end up holding.
 *
 * FIVE FOR EVERYONE. The growth stage used to cap this — Start gave 2,
 * Momentum 3 — which meant a just-launched business was told "0 of 2 selected"
 * and could never reach the five the product now offers. The stage is a
 * statement about ambition, not about entitlement, so it no longer limits what
 * someone may choose.
 *
 * The stage ranges in SIZES survive as advisory copy (see describeStageRange)
 * and are deliberately NOT consulted here.
 *
 * `stage` is not a parameter any more, rather than an ignored one: a parameter
 * that no longer affects the result is a trap for the next reader.
 */
export function recommendationCapacity(args: {
  /** The plan's `max_initiatives`, if one applies (REQ-13.15). */
  planLimit?: number | null;
}): number {
  let capacity = MAX_RECOMMENDED_INITIATIVES;

  /**
   * REQ-13.15 — a smaller plan limit still wins, and must.
   *
   * Billing re-checks `max_initiatives` when the plan is built, so offering
   * more than the tier allows would only fail later with a worse message.
   *
   * INERT AT CURRENT SETTINGS: Starter allows 10 and Pro/Mastery are
   * unlimited, so nothing is capped below five today. It stays because the
   * limits are admin-editable, and a tier tightened to 3 must shrink the
   * screen rather than break the build.
   */
  if (args.planLimit !== null && args.planLimit !== undefined) {
    const limit = Math.floor(args.planLimit);
    /**
     * -1 is this project's "unlimited" sentinel, not a cap of minus one.
     *
     * The recommend route's loadInitiativeLimit already converts it to null, so
     * this is belt-and-braces for any other caller — but treating -1 as a
     * literal limit would clamp capacity to zero and silently give Pro and
     * Mastery customers no recommendations at all, which is worth being
     * explicit about.
     */
    if (limit >= 0) capacity = Math.min(capacity, limit);
  }

  return Math.max(0, capacity);
}

/**
 * How many alternatives to put in front of the user.
 *
 * THIS IS NOT "HOW MANY TO ADD". It used to be: the user's own initiatives were
 * subtracted from the stage budget, so someone who had already entered four saw
 * at most one suggestion, and someone whose own plan covered the revenue goal
 * saw none at all.
 *
 * The product decision changed. Recommendations are now ALTERNATIVES shown
 * alongside the user's own, and the user picks up to `recommendationCapacity` of the
 * combined set — so having four of their own is a reason to show them four
 * contenders, not a reason to show them one. The cap is enforced on what they
 * SELECT, not on what they are shown.
 *
 * `gapToGoal` no longer gates this either. A plan that already covers the goal
 * can still be a worse plan than the alternatives, and the user is the one
 * qualified to judge that.
 *
 * What it still respects:
 *   - a plan whose capacity is zero gets nothing, because nothing could be kept;
 *   - the pool is capped at the ceiling, so we never render a wall of cards.
 *
 * NEITHER `existingCount` NOR `gapToGoal` IS AN INPUT ANY MORE, and dropping
 * them rather than ignoring them is deliberate — a parameter that no longer
 * affects the result is a trap for the next reader. Enough contenders are shown
 * to fill the plan outright, so a swap is always possible: someone with five of
 * their own can still replace all five.
 */
export function recommendationCount(args: {
  /** The plan's `max_initiatives`, if one applies (REQ-13.15). */
  planLimit?: number | null;
  /**
   * How many eligible candidates exist at all, after the admin allowlist and
   * the eligibility rules have had their say.
   *
   * Optional so existing callers keep the old behaviour of "as many as the
   * plan could hold". Supplying it is what lets the shortlist leave swap
   * headroom — see SWAP_RESERVE.
   */
  poolSize?: number | null;
}): number {
  const capacity = recommendationCapacity(args);

  // Nothing known about the pool: show as many as the plan could hold.
  if (args.poolSize === null || args.poolSize === undefined) return capacity;

  const pool = Math.max(0, Math.floor(args.poolSize));
  if (pool === 0) return 0;

  /**
   * LEAVE SOMETHING TO SWAP TO.
   *
   * Swap replaces a card with the next unseen alternative, and alternatives
   * are whatever the shortlist did not take. So showing `capacity` cards out
   * of a pool of `capacity` leaves nothing, and the Swap button is disabled on
   * every card from the moment the screen loads.
   *
   * That was the live situation: six initiatives were active, the shortlist
   * asked for five, and one of the user's own overlapped — leaving zero. The
   * control was correct to disable itself and useless to the user.
   *
   * So the shortlist shrinks toward the minimum to keep a reserve, rather than
   * filling to the maximum. Both ends are respected: never fewer than
   * MIN_RECOMMENDED_INITIATIVES (unless the pool itself is smaller), never
   * more than capacity.
   *
   *   pool 22 -> 5 shown, 17 spare    plenty either way
   *   pool  8 -> 5 shown,  3 spare    reserve satisfied at full size
   *   pool  6 -> 3 shown,  3 spare    shrinks to keep swapping alive
   *   pool  4 -> 3 shown,  1 spare    minimum wins over the full reserve
   *   pool  2 -> 2 shown,  0 spare    nothing to reserve; Swap disables
   *
   * A SMALL POOL IS THE REAL CONSTRAINT, not this arithmetic. With six active
   * initiatives the best available is three shown and three swappable;
   * offering five AND a working Swap needs more of the library switched on.
   */
  const withReserve = pool - SWAP_RESERVE;
  const target = Math.max(MIN_RECOMMENDED_INITIATIVES, withReserve);

  return Math.min(capacity, pool, target);
}

/**
 * Does this many initiatives sit within the stage's range?
 *
 * Used to describe the plan back to the user rather than to block anything —
 * their own count is their choice, and the recommendations screen comments on
 * it instead of refusing it.
 */
export function withinStageRange(
  stage: string | null | undefined,
  count: number
): boolean {
  const { min, max } = sizeForStage(stage);
  if (count < min) return false;
  // The hard ceiling applies even where a stage leaves its own max open.
  const ceiling = Math.min(max ?? MAX_RECOMMENDED_INITIATIVES, MAX_RECOMMENDED_INITIATIVES);
  return count <= ceiling;
}

/** Human description of the stage's range, for the screen copy. */
export function describeStageRange(stage: string | null | undefined): string {
  const { min, max } = sizeForStage(stage);
  const ceiling = Math.min(max ?? MAX_RECOMMENDED_INITIATIVES, MAX_RECOMMENDED_INITIATIVES);
  // No "or more" any longer: every stage now has a real upper bound, and
  // describing one as open-ended would promise a plan we will not build.
  if (min >= ceiling) return String(ceiling);
  return `${min} to ${ceiling}`;
}
