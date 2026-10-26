'use client';
/**
 * Month targets for a calendar year, read from the annual plan and the plan
 * horizon. Browser-side; the arithmetic lives in period-totals.ts.
 */
import { planService } from '@/services/plan.service';
import { coveredMonths, monthlyTargets } from '@/lib/planning/period-totals';

/** Twelve month targets (index 0 = January); all zero when the year has no plan. */
export async function loadMonthTargets(companyId: string, year: number): Promise<number[]> {
  const [plan, horizon] = await Promise.all([
    planService.getAnnualPlan(companyId, year),
    planService.getPlanHorizon(companyId),
  ]);
  const covered = coveredMonths(horizon?.planStartMonth, horizon?.horizonMonths, year);
  return monthlyTargets(plan?.baselineRevenue ?? 0, covered);
}
