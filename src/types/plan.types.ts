/**
 * Plan domain types
 * Represents the annual, quarterly, monthly, weekly planning hierarchy
 */

export type PlanningHorizon = 'annual' | 'quarterly' | 'monthly' | 'weekly';
export type PlanStatus = 'draft' | 'active' | 'archived';

export interface AnnualPlan {
  id: string;
  companyId: string;
  year: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  status: PlanStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuarterlyPlan {
  id: string;
  annualPlanId: string;
  quarter: 1 | 2 | 3 | 4;
  year: number;
  targetRevenue: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonthlyPlan {
  id: string;
  quarterlyPlanId: string;
  month: number; // 1-12
  year: number;
  targetRevenue: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeeklyPlan {
  id: string;
  monthlyPlanId: string;
  weekStartDate: Date;
  weekEndDate: Date;
  targetRevenue: number;
  topPriorities: string[]; // 1-3 priority IDs
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnnualPlanDTO {
  companyId: string;
  year: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  notes?: string;
}

export interface UpdateAnnualPlanDTO {
  baselineRevenue?: number;
  stretchRevenue?: number;
  operatingBudget?: number;
  status?: PlanStatus;
  notes?: string;
}
