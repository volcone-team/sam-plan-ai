/**
 * Subscription Plan Service
 * Admin-configurable plans with limits and features.
 * Uses localStorage for now — swap to Supabase later.
 */

import type {
  SubscriptionPlan,
  SubscriptionPlanFull,
  PlanLimit,
  PlanFeature,
  CreateSubscriptionPlanDTO,
  UpdateSubscriptionPlanDTO,
  LimitKey,
  FeatureKey,
} from '@/types/subscription-plan.types';
import { LIMIT_KEYS, FEATURE_KEYS } from '@/types/subscription-plan.types';

const STORAGE_PLANS = 'sam-subscription-plans';
const STORAGE_LIMITS = 'sam-plan-limits';
const STORAGE_FEATURES = 'sam-plan-features';

function genId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Default Data ─────────────────────────────────────────────
const DEFAULT_PLANS: SubscriptionPlan[] = [
  { id: 'plan-starter', name: 'Starter', description: 'For solo operators getting started with revenue planning.', tagline: 'Get started', monthlyPrice: 49, annualPrice: 490, isActive: true, isDefault: true, displayOrder: 1, createdAt: new Date(), updatedAt: new Date() },
  { id: 'plan-pro', name: 'Pro', description: 'For growing teams that need collaboration and deeper analytics.', tagline: 'Most popular', monthlyPrice: 149, annualPrice: 1490, isActive: true, isDefault: false, displayOrder: 2, createdAt: new Date(), updatedAt: new Date() },
  { id: 'plan-mastery', name: 'Mastery', description: 'For serious operators who want the full system plus expert reviews.', tagline: 'Full access', monthlyPrice: 0, annualPrice: 4997, isActive: true, isDefault: false, displayOrder: 3, createdAt: new Date(), updatedAt: new Date() },
];

const DEFAULT_LIMITS: Record<string, Record<LimitKey, number>> = {
  'plan-starter': { max_users: 1, max_initiatives: 10, plan_regenerations: 1, ai_uses_month: 5, max_products: 3, csv_exports_month: 0 },
  'plan-pro': { max_users: 5, max_initiatives: -1, plan_regenerations: 3, ai_uses_month: 20, max_products: 10, csv_exports_month: -1 },
  'plan-mastery': { max_users: 10, max_initiatives: -1, plan_regenerations: -1, ai_uses_month: -1, max_products: -1, csv_exports_month: -1 },
};

const DEFAULT_FEATURES: Record<string, Record<FeatureKey, boolean>> = {
  'plan-starter': { advanced_analytics: false, custom_initiative_types: false, ai_weekly_insights: false, multi_user: false, benchmark_contribution: true, priority_support: false, annual_reviews: false },
  'plan-pro': { advanced_analytics: true, custom_initiative_types: false, ai_weekly_insights: true, multi_user: true, benchmark_contribution: true, priority_support: false, annual_reviews: false },
  'plan-mastery': { advanced_analytics: true, custom_initiative_types: true, ai_weekly_insights: true, multi_user: true, benchmark_contribution: true, priority_support: true, annual_reviews: true },
};

// ─── Init from localStorage or defaults ───────────────────────
function getPlans(): SubscriptionPlan[] {
  if (typeof window === 'undefined') return DEFAULT_PLANS;
  const stored = localStorage.getItem(STORAGE_PLANS);
  if (stored) return JSON.parse(stored);
  localStorage.setItem(STORAGE_PLANS, JSON.stringify(DEFAULT_PLANS));
  return DEFAULT_PLANS;
}

function getLimits(): PlanLimit[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_LIMITS);
  if (stored) return JSON.parse(stored);

  const limits: PlanLimit[] = [];
  for (const [planId, vals] of Object.entries(DEFAULT_LIMITS)) {
    for (const lk of LIMIT_KEYS) {
      limits.push({ id: genId(), planId, limitKey: lk.key, limitLabel: lk.label, limitValue: vals[lk.key] });
    }
  }
  localStorage.setItem(STORAGE_LIMITS, JSON.stringify(limits));
  return limits;
}

function getFeatures(): PlanFeature[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_FEATURES);
  if (stored) return JSON.parse(stored);

  const features: PlanFeature[] = [];
  for (const [planId, vals] of Object.entries(DEFAULT_FEATURES)) {
    for (const fk of FEATURE_KEYS) {
      features.push({ id: genId(), planId, featureKey: fk.key, featureLabel: fk.label, enabled: vals[fk.key] });
    }
  }
  localStorage.setItem(STORAGE_FEATURES, JSON.stringify(features));
  return features;
}

// ─── Service ──────────────────────────────────────────────────
class SubscriptionPlanService {
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    await delay(50);
    return getPlans().sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getActivePlans(): Promise<SubscriptionPlan[]> {
    const plans = await this.getAllPlans();
    return plans.filter(p => p.isActive);
  }

  async getPlanFull(planId: string): Promise<SubscriptionPlanFull | null> {
    await delay(50);
    const plans = getPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) return null;

    const limits = getLimits().filter(l => l.planId === planId);
    const features = getFeatures().filter(f => f.planId === planId);
    return { plan, limits, features };
  }

  async getAllPlansFull(): Promise<SubscriptionPlanFull[]> {
    const plans = await this.getAllPlans();
    const results: SubscriptionPlanFull[] = [];
    for (const plan of plans) {
      const full = await this.getPlanFull(plan.id);
      if (full) results.push(full);
    }
    return results;
  }

  async createPlan(dto: CreateSubscriptionPlanDTO): Promise<SubscriptionPlan> {
    await delay(100);
    const plans = getPlans();
    const newPlan: SubscriptionPlan = {
      id: genId(),
      name: dto.name,
      description: dto.description || '',
      tagline: dto.tagline || '',
      monthlyPrice: dto.monthlyPrice,
      annualPrice: dto.annualPrice,
      isActive: true,
      isDefault: false,
      displayOrder: plans.length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    plans.push(newPlan);
    localStorage.setItem(STORAGE_PLANS, JSON.stringify(plans));

    // Create default limits and features for new plan
    const limits = getLimits();
    for (const lk of LIMIT_KEYS) {
      limits.push({ id: genId(), planId: newPlan.id, limitKey: lk.key, limitLabel: lk.label, limitValue: 0 });
    }
    localStorage.setItem(STORAGE_LIMITS, JSON.stringify(limits));

    const features = getFeatures();
    for (const fk of FEATURE_KEYS) {
      features.push({ id: genId(), planId: newPlan.id, featureKey: fk.key, featureLabel: fk.label, enabled: false });
    }
    localStorage.setItem(STORAGE_FEATURES, JSON.stringify(features));

    return newPlan;
  }

  async updatePlan(planId: string, dto: UpdateSubscriptionPlanDTO): Promise<SubscriptionPlan | null> {
    await delay(100);
    const plans = getPlans();
    const idx = plans.findIndex(p => p.id === planId);
    if (idx < 0) return null;

    plans[idx] = { ...plans[idx], ...dto, updatedAt: new Date() };
    localStorage.setItem(STORAGE_PLANS, JSON.stringify(plans));
    return plans[idx];
  }

  async deletePlan(planId: string): Promise<void> {
    await delay(100);
    const plans = getPlans().filter(p => p.id !== planId);
    localStorage.setItem(STORAGE_PLANS, JSON.stringify(plans));
    const limits = getLimits().filter(l => l.planId !== planId);
    localStorage.setItem(STORAGE_LIMITS, JSON.stringify(limits));
    const features = getFeatures().filter(f => f.planId !== planId);
    localStorage.setItem(STORAGE_FEATURES, JSON.stringify(features));
  }

  async updateLimit(planId: string, limitKey: string, value: number): Promise<void> {
    await delay(50);
    const limits = getLimits();
    const idx = limits.findIndex(l => l.planId === planId && l.limitKey === limitKey);
    if (idx >= 0) {
      limits[idx].limitValue = value;
    } else {
      const lk = LIMIT_KEYS.find(l => l.key === limitKey);
      limits.push({ id: genId(), planId, limitKey, limitLabel: lk?.label || limitKey, limitValue: value });
    }
    localStorage.setItem(STORAGE_LIMITS, JSON.stringify(limits));
  }

  async updateFeature(planId: string, featureKey: string, enabled: boolean): Promise<void> {
    await delay(50);
    const features = getFeatures();
    const idx = features.findIndex(f => f.planId === planId && f.featureKey === featureKey);
    if (idx >= 0) {
      features[idx].enabled = enabled;
    } else {
      const fk = FEATURE_KEYS.find(f => f.key === featureKey);
      features.push({ id: genId(), planId, featureKey, featureLabel: fk?.label || featureKey, enabled });
    }
    localStorage.setItem(STORAGE_FEATURES, JSON.stringify(features));
  }

  // ─── Limit checking (for customer-side enforcement) ─────────
  async getLimitForPlan(planId: string, limitKey: string): Promise<number> {
    await delay(20);
    const limits = getLimits();
    const limit = limits.find(l => l.planId === planId && l.limitKey === limitKey);
    return limit?.limitValue ?? 0;
  }

  async isFeatureEnabled(planId: string, featureKey: string): Promise<boolean> {
    await delay(20);
    const features = getFeatures();
    const feature = features.find(f => f.planId === planId && f.featureKey === featureKey);
    return feature?.enabled ?? false;
  }
}

export const subscriptionPlanService = new SubscriptionPlanService();
