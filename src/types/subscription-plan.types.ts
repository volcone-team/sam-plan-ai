/**
 * Admin-Configurable Subscription Plan types
 */

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  tagline: string;
  monthlyPrice: number;
  annualPrice: number;
  isActive: boolean;
  isDefault: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanLimit {
  id: string;
  planId: string;
  limitKey: string;
  limitLabel: string;
  limitValue: number; // -1 = unlimited, 0 = disabled, >0 = capped
}

export interface PlanFeature {
  id: string;
  planId: string;
  featureKey: string;
  featureLabel: string;
  enabled: boolean;
}

/**
 * Full plan with resolved limits and features
 */
export interface SubscriptionPlanFull {
  plan: SubscriptionPlan;
  limits: PlanLimit[];
  features: PlanFeature[];
}

/**
 * For creating/updating plans from admin UI
 */
export interface CreateSubscriptionPlanDTO {
  name: string;
  description?: string;
  tagline?: string;
  monthlyPrice: number;
  annualPrice: number;
}

export interface UpdateSubscriptionPlanDTO {
  name?: string;
  description?: string;
  tagline?: string;
  monthlyPrice?: number;
  annualPrice?: number;
  isActive?: boolean;
  displayOrder?: number;
}

/**
 * All available limit keys in the system
 */
export const LIMIT_KEYS = [
  { key: 'max_users', label: 'Max team members' },
  { key: 'max_initiatives', label: 'Max initiatives/year' },
  { key: 'plan_regenerations', label: 'Plan regenerations/month' },
  { key: 'ai_uses_month', label: 'AI generation uses/month' },
  { key: 'max_products', label: 'Max products' },
  { key: 'csv_exports_month', label: 'CSV exports/month' },
] as const;

/**
 * All available feature keys in the system
 */
export const FEATURE_KEYS = [
  { key: 'advanced_analytics', label: 'Advanced Analytics' },
  { key: 'custom_initiative_types', label: 'Custom Initiative Types' },
  { key: 'ai_weekly_insights', label: 'AI Weekly Insights' },
  { key: 'multi_user', label: 'Multi-User Access' },
  { key: 'benchmark_contribution', label: 'Benchmark Contribution' },
  { key: 'priority_support', label: 'Priority Support' },
  { key: 'annual_reviews', label: 'Annual Plan Reviews' },
] as const;

export type LimitKey = typeof LIMIT_KEYS[number]['key'];
export type FeatureKey = typeof FEATURE_KEYS[number]['key'];
