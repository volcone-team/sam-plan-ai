/**
 * How many initiatives to recommend, by stage (REQ-13.13).
 *
 *   Start     1-2    Launching. One thing done properly beats four half-run.
 *   Momentum  2-4    Selling consistently and ready for more.
 *   Scale     4+     Has a team and can run several at once.
 *
 * Separated from the eligibility rules because it answers a different question:
 * eligibility is "could they run this", sizing is "how much should we ask of
 * them". Conflating the two produced the failure this is meant to avoid — a
 * Start-stage business handed six initiatives, running none of them.
 */

export type Stage = "start" | "momentum" | "scale";

export interface StageSize {
  min: number;
  /** Null for Scale, which the spec leaves open-ended. */
  max: number | null;
  /** What to aim for when there is enough gap to justify it. */
  target: number;
}

const SIZES: Record<Stage, StageSize> = {
  start: { min: 1, max: 2, target: 2 },
  momentum: { min: 2, max: 4, target: 3 },
  // "4 or more" — capped in practice by the plan's max_initiatives (REQ-13.15)
  // rather than here, so a Scale customer on a larger plan is not held back by
  // a number invented in this file.
  scale: { min: 4, max: null, target: 5 },
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
 * How many to recommend, given what the user already has.
 *
 * Counts the user's OWN initiatives against the stage budget: someone at
 * Momentum who already planned three does not need three more. Paths A and B
 * both reach this, and on Path A the user may already be at or over capacity —
 * in which case the honest answer is zero additions, not a token suggestion.
 *
 * `gapToGoal` of zero also returns zero. If their own plan already covers the
 * goal there is nothing to recommend, and adding initiatives anyway would
 * manufacture work to justify the screen.
 */
export function recommendationCount(args: {
  stage: string | null | undefined;
  /** Initiatives the user entered themselves. */
  existingCount: number;
  /** Revenue still needed. Zero means covered. */
  gapToGoal: number;
  /** The plan's `max_initiatives`, if one applies (REQ-13.15). */
  planLimit?: number | null;
}): number {
  const { min, max, target } = sizeForStage(args.stage);
  const existing = Math.max(0, Math.floor(args.existingCount));

  // Nothing to close.
  if (args.gapToGoal <= 0) return 0;

  // Room left within the stage's own budget.
  const ceiling = max ?? Math.max(target, existing + target);
  let count = Math.max(0, Math.min(target, ceiling) - existing);

  /**
   * A gap with no room left in the stage budget still gets ONE suggestion, so
   * long as the plan limit allows it. The alternative is showing a gap bar with
   * a shortfall and no way to address it, which tells the user they have a
   * problem and nothing to do about it.
   */
  if (count === 0 && existing < ceiling) count = 1;

  // REQ-13.15 — never propose more than the plan can hold. Billing enforces
  // this server-side anyway, so exceeding it here only fails later with a
  // worse message.
  if (args.planLimit !== null && args.planLimit !== undefined) {
    const remaining = Math.max(0, args.planLimit - existing);
    count = Math.min(count, remaining);
  }

  return Math.max(0, count);
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
  return max === null || count <= max;
}

/** Human description of the stage's range, for the screen copy. */
export function describeStageRange(stage: string | null | undefined): string {
  const { min, max } = sizeForStage(stage);
  if (max === null) return `${min} or more`;
  if (min === max) return String(min);
  return `${min} to ${max}`;
}
