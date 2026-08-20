/**
 * Subscription domain types
 * Billing tiers and subscription management
 * Full Stripe integration in Phase 13; types here for Phase 11 foundation
 */

export type SubscriptionTier = 'starter' | 'pro' | 'mastery';
export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus =
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'past_due'
  | 'trial';

export interface SubscriptionTierConfig {
  tier: SubscriptionTier;
  monthlyPrice: number;
  annualPrice: number;
  features: {
    maxCompanies: number;
    maxUsers: number;
    apiAccess: boolean;
    advancedAnalytics: boolean;
    prioritySupport: boolean;
    annualReviews: number; // e.g., Mastery has 3
  };
}

export interface Subscription {
  id: string;
  companyId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  // Pricing
  monthlyPrice: number;
  annualPrice: number;
  currentPrice: number; // what they're paying (annual or monthly)
  // Dates
  startDate: Date;
  renewalDate: Date;
  cancelledAt?: Date;
  // Trial (if applicable)
  isTrialActive: boolean;
  trialEndsAt?: Date;
  // Metadata
  stripeCustomerId?: string; // Phase 13
  stripeSubscriptionId?: string; // Phase 13
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionDTO {
  companyId: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  isTrialActive?: boolean;
  trialDays?: number;
}

export interface UpdateSubscriptionDTO {
  tier?: SubscriptionTier;
  status?: SubscriptionStatus;
  billingCycle?: BillingCycle;
  renewalDate?: Date;
  isTrialActive?: boolean;
}

export interface UpgradeSubscriptionDTO {
  companyId: string;
  newTier: SubscriptionTier;
}

/**
 * BenchmarkParticipation
 * Whether a company opts in to the benchmark data flywheel
 * (Phase 16 - data collection mechanism)
 */
export interface BenchmarkParticipation {
  id: string;
  companyId: string;
  // Consent
  optedIn: boolean;
  optInDate?: Date;
  optOutDate?: Date;
  // Preferences
  allowBenchmarkContribution: boolean;
  allowIntegrationDataUse: boolean;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateBenchmarkParticipationDTO {
  optedIn?: boolean;
  allowBenchmarkContribution?: boolean;
  allowIntegrationDataUse?: boolean;
}

export const TIER_CONFIGS: Record<SubscriptionTier, SubscriptionTierConfig> = {
  starter: {
    tier: 'starter',
    monthlyPrice: 49,
    annualPrice: 490,
    features: {
      maxCompanies: 1,
      maxUsers: 1,
      apiAccess: false,
      advancedAnalytics: false,
      prioritySupport: false,
      annualReviews: 0,
    },
  },
  pro: {
    tier: 'pro',
    monthlyPrice: 149,
    annualPrice: 1490,
    features: {
      maxCompanies: 1,
      maxUsers: 5,
      apiAccess: false,
      advancedAnalytics: true,
      prioritySupport: false,
      annualReviews: 0,
    },
  },
  mastery: {
    tier: 'mastery',
    monthlyPrice: 0, // only annual
    annualPrice: 4997,
    features: {
      maxCompanies: 1,
      maxUsers: 10,
      apiAccess: true,
      advancedAnalytics: true,
      prioritySupport: true,
      annualReviews: 3,
    },
  },
};
