/**
 * Which year the dashboard should open on when the user has not chosen one.
 *
 * Client rule (Oct 2026): if the current year has no base goal and no stretch
 * goal, but next year does, open on next year. A plan built late in the year
 * often starts in January, and landing on an empty current year looks broken.
 *
 * Pure: goals in, a year out. A missing plan counts as zero goals.
 */

export interface YearGoals {
  baselineRevenue?: number | null;
  stretchRevenue?: number | null;
}

const hasGoal = (plan: YearGoals | null | undefined): boolean =>
  (Number(plan?.baselineRevenue) || 0) > 0 || (Number(plan?.stretchRevenue) || 0) > 0;

export function defaultDashboardYear(
  currentYear: number,
  currentPlan: YearGoals | null | undefined,
  nextPlan: YearGoals | null | undefined
): number {
  return !hasGoal(currentPlan) && hasGoal(nextPlan) ? currentYear + 1 : currentYear;
}
