'use client';
/**
 * Month targets for a calendar year, read from the annual plan and the plan
 * horizon. Browser-side; the arithmetic lives in period-totals.ts.
 */
import { planService } from '@/services/plan.service';
import { coveredMonths, monthlyTargets } from '@/lib/planning/period-totals';
import { horizonEnd } from '@/lib/planning/revenue-spread';
import type { DateOnly } from '@/lib/plan-dates';

export interface PlanPeriod {
  /** Twelve month targets (index 0 = January); all zero when the year has no plan. */
  monthTargets: number[];
  /** Last day of the plan horizon, or null when no horizon is recorded. */
  planEnd: DateOnly | null;
}

export async function loadPlanPeriod(companyId: string, year: number): Promise<PlanPeriod> {
  const [plan, horizon] = await Promise.all([
    planService.getAnnualPlan(companyId, year),
    planService.getPlanHorizon(companyId),
  ]);
  const covered = coveredMonths(horizon?.planStartMonth, horizon?.horizonMonths, year);
  return {
    monthTargets: monthlyTargets(plan?.baselineRevenue ?? 0, covered),
    planEnd: horizonEnd(horizon?.planStartMonth, horizon?.horizonMonths),
  };
}

/** Twelve month targets (index 0 = January); all zero when the year has no plan. */
export async function loadMonthTargets(companyId: string, year: number): Promise<number[]> {
  return (await loadPlanPeriod(companyId, year)).monthTargets;
}
