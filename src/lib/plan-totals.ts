/**
 * Plan totals, derived from INITIATIVES.
 *
 * THE BUG THIS FIXES. "Does your plan add up?" read the `projections` table
 * while the initiative cards summed the `initiatives` table, and the two are
 * written from two separate parts of the model's response:
 *
 *   - `initiatives[].revenueGood/Better/Best` — per initiative
 *   - `monthlyProjections.good/better/best`   — a 12-month array
 *
 * Nothing reconciles them, so they drift. On the reported account six
 * initiatives totalling 135,000 / 210,000 / 293,000 were shown directly above a
 * panel claiming 256,000 / 420,000 / 630,000. Both numbers were "real"; they
 * came from different answers to the same question.
 *
 * INITIATIVES WIN, for three reasons:
 *   1. they are what the user can see, open and edit — a total that disagrees
 *      with the rows above it is indefensible, whichever figure is "right";
 *   2. editing an initiative's revenue updates the total, which is what anyone
 *      would expect; the projections array is frozen at generation;
 *   3. the list view's totals row (item 14) sums the visible rows, so deriving
 *      the panel the same way makes the two agree by construction.
 *
 * Projections remain the source for MONTHLY SHAPE — when revenue lands across
 * the year — which initiative rows alone cannot express as cleanly. They are no
 * longer the source for annual totals.
 */

export interface InitiativeRevenue {
  revenueGood: number;
  revenueBetter: number;
  revenueBest: number;
  plannedBudget?: number;
  actualSpend?: number;
}

export interface PlanTotals {
  good: number;
  better: number;
  best: number;
  plannedBudget: number;
  actualSpend: number;
  count: number;
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum the initiatives that make up a plan.
 *
 * Non-finite and missing values are treated as 0 rather than poisoning the
 * total with NaN: one bad row would otherwise blank the entire panel.
 */
export function sumInitiatives(initiatives: readonly InitiativeRevenue[]): PlanTotals {
  return initiatives.reduce<PlanTotals>(
    (acc, i) => ({
      good: acc.good + num(i.revenueGood),
      better: acc.better + num(i.revenueBetter),
      best: acc.best + num(i.revenueBest),
      plannedBudget: acc.plannedBudget + num(i.plannedBudget),
      actualSpend: acc.actualSpend + num(i.actualSpend),
      count: acc.count + 1,
    }),
    { good: 0, better: 0, best: 0, plannedBudget: 0, actualSpend: 0, count: 0 }
  );
}

/**
 * Does the plan's expected case cover a goal, and by how much?
 *
 * Powers item 12's copy: "Covers your $75,000 baseline goal." or
 * "$370,000 short of your $1,000,000 stretch goal." Returning the SHORTFALL
 * rather than a boolean lets the caller state the gap, which is the actionable
 * part — "falls short" alone tells nobody how much to close.
 */
export interface GoalCoverage {
  covers: boolean;
  /** Amount still needed. 0 when covered. */
  shortfall: number;
  /** Amount above the goal. 0 when not covered. */
  surplus: number;
  /** Share of the goal covered, 0-100 and capped. */
  percent: number;
  /** True when no goal has been set, so neither phrasing applies. */
  noGoal: boolean;
}

export function goalCoverage(projected: number, goal: number): GoalCoverage {
  const p = num(projected);
  const g = num(goal);

  if (g <= 0) {
    return { covers: false, shortfall: 0, surplus: 0, percent: 0, noGoal: true };
  }

  const covers = p >= g;
  return {
    covers,
    shortfall: covers ? 0 : g - p,
    surplus: covers ? p - g : 0,
    percent: Math.max(0, Math.min(100, Math.round((p / g) * 100))),
    noGoal: false,
  };
}

/**
 * Progress toward a goal from money ACTUALLY earned.
 *
 * For item 10's goal cards: "$X earned · $Y to go". Separate from
 * `goalCoverage`, which compares a PROJECTION against the goal — conflating
 * "we expect to earn this" with "we have earned this" is the kind of error that
 * makes a dashboard untrustworthy.
 */
export interface GoalProgress {
  earned: number;
  remaining: number;
  percent: number;
  /** True once the goal has been reached. */
  reached: boolean;
  noGoal: boolean;
}

export function goalProgress(earned: number, goal: number): GoalProgress {
  const e = Math.max(0, num(earned));
  const g = num(goal);

  if (g <= 0) {
    return { earned: e, remaining: 0, percent: 0, reached: false, noGoal: true };
  }

  return {
    earned: e,
    remaining: Math.max(0, g - e),
    percent: Math.max(0, Math.min(100, Math.round((e / g) * 100))),
    reached: e >= g,
    noGoal: false,
  };
}

/**
 * Should pace tracking be shown for this plan year?
 *
 * Item 8. On a FUTURE year the three tracking cards reported "Expected: 210,000
 * · 0% of pace · behind by 210,000" before the year had begun — measuring a
 * company against a period that has not started. Month- and quarter-to-date
 * simultaneously showed "Expected: 0", because an elapsed-fraction of a future
 * month is zero while the year total is not.
 *
 * A PAST year keeps tracking: the comparison is complete and is the whole point
 * of reviewing it.
 */
export function shouldTrackPace(planYear: number, now: Date = new Date()): boolean {
  return planYear <= now.getFullYear();
}

/** "Tracking starts January 1, 2027" for a future plan year. */
export function trackingStartsLabel(planYear: number): string {
  return `Tracking starts January 1, ${planYear}`;
}
