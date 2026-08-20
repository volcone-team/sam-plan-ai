/**
 * Projection domain types
 * Rolled-up revenue across Good/Better/Best scenarios by month/quarter
 */

export type ScenarioType = 'good' | 'better' | 'best';
export type ProjectionPeriod = 'monthly' | 'quarterly' | 'annual';

export interface MonthlyProjection {
  year: number;
  month: number; // 1-12
  revenue: number;
  expectedInitiatives: string[]; // initiative IDs active in this month
}

export interface QuarterlyProjection {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  revenue: number;
  expectedInitiatives: string[]; // initiative IDs active in this quarter
}

export interface Projection {
  id: string;
  companyId: string;
  annualPlanId: string;
  // Scenario type
  scenario: ScenarioType;
  // Period type
  period: ProjectionPeriod;
  // By-product breakdown
  byProduct: {
    productId: string;
    revenue: number;
  }[];
  // By-initiative breakdown
  byInitiative: {
    initiativeId: string;
    revenue: number;
  }[];
  // Timeline
  monthly?: MonthlyProjection[];
  quarterly?: QuarterlyProjection[];
  annual?: {
    year: number;
    revenue: number;
  };
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ProjectionSummary
 * Simplified view of all three scenarios (Good/Better/Best) for quick comparison
 */
export interface ProjectionSummary {
  companyId: string;
  annualPlanId: string;
  good: number;
  better: number;
  best: number;
  // Additional context
  conservative70Percent?: number; // 70% of baseline (per spec section 1.3)
  growthPercentage?: number; // from prior year to baseline
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectionDTO {
  companyId: string;
  annualPlanId: string;
  scenario: ScenarioType;
  period: ProjectionPeriod;
  byProduct: Array<{
    productId: string;
    revenue: number;
  }>;
  byInitiative: Array<{
    initiativeId: string;
    revenue: number;
  }>;
  monthly?: MonthlyProjection[];
  quarterly?: QuarterlyProjection[];
  annual?: {
    year: number;
    revenue: number;
  };
}

export interface UpdateProjectionDTO {
  byProduct?: Array<{
    productId: string;
    revenue: number;
  }>;
  byInitiative?: Array<{
    initiativeId: string;
    revenue: number;
  }>;
  monthly?: MonthlyProjection[];
  quarterly?: QuarterlyProjection[];
}
