/**
 * Subscription Plan Service
 *
 * NOW BACKED BY THE DATABASE via /api/admin/plans.
 *
 * This used to keep plans, limits and features in localStorage with a note
 * saying "swap to Supabase later". The consequence was subtle and expensive:
 * editing a price in Manage Plans only changed the admin's own browser. The real
 * `subscription_plans` table — which Stripe price sync reads, and which every
 * limit check reads — was never touched. Prices appeared to save and then had no
 * effect anywhere, and the ids did not even match (localStorage used
 * 'plan-mastery', the database uses UUIDs).
 *
 * All methods now go through the API, which is super-admin gated and audit-logged.
 */

import type {
  SubscriptionPlan,
  SubscriptionPlanFull,
  PlanLimit,
  PlanFeature,
  CreateSubscriptionPlanDTO,
  UpdateSubscriptionPlanDTO,
} from '@/types/subscription-plan.types';
import { LIMIT_KEYS, FEATURE_KEYS } from '@/types/subscription-plan.types';

interface ApiPlan {
  id: string; name: string; description: string | null; tagline: string | null;
  monthly_price: number; annual_price: number;
  is_active: boolean; is_default: boolean; display_order: number;
}
interface ApiLimit {
  id: string; plan_id: string; limit_key: string; limit_label: string; limit_value: number;
}
interface ApiFeature {
  id: string; plan_id: string; feature_key: string; feature_label: string; enabled: boolean;
}

interface PlansResponse {
  plans: ApiPlan[];
  limits: ApiLimit[];
  features: ApiFeature[];
  stripePrices: {
    plan_id: string; billing_cycle: string; unit_amount: number;
    stripe_mode: string; is_current: boolean;
  }[];
}

function toPlan(p: ApiPlan): SubscriptionPlan {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    tagline: p.tagline ?? '',
    monthlyPrice: Number(p.monthly_price) || 0,
    annualPrice: Number(p.annual_price) || 0,
    isActive: p.is_active,
    isDefault: p.is_default,
    displayOrder: p.display_order,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function fetchAll(): Promise<PlansResponse> {
  const res = await fetch('/api/admin/plans', { credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || 'Could not load plans');
  }
  return (await res.json()) as PlansResponse;
}

class SubscriptionPlanService {
  async getAllPlans(): Promise<SubscriptionPlan[]> {
    const data = await fetchAll();
    return data.plans.map(toPlan);
  }

  async getActivePlans(): Promise<SubscriptionPlan[]> {
    return (await this.getAllPlans()).filter((p) => p.isActive);
  }

  async getAllPlansFull(): Promise<SubscriptionPlanFull[]> {
    const data = await fetchAll();

    return data.plans.map((p) => {
      // Missing rows are filled from the known key list so the editor always
      // renders every limit and feature, even for a plan created before a new
      // key existed. Default 0 for limits (not -1) so a new key is never
      // accidentally unlimited.
      const limits: PlanLimit[] = LIMIT_KEYS.map((lk) => {
        const row = data.limits.find((l) => l.plan_id === p.id && l.limit_key === lk.key);
        return {
          id: row?.id ?? `${p.id}-${lk.key}`,
          planId: p.id,
          limitKey: lk.key,
          limitLabel: row?.limit_label ?? lk.label,
          limitValue: row?.limit_value ?? 0,
        };
      });

      const features: PlanFeature[] = FEATURE_KEYS.map((fk) => {
        const row = data.features.find((f) => f.plan_id === p.id && f.feature_key === fk.key);
        return {
          id: row?.id ?? `${p.id}-${fk.key}`,
          planId: p.id,
          featureKey: fk.key,
          featureLabel: row?.feature_label ?? fk.label,
          enabled: row?.enabled ?? false,
        };
      });

      return { plan: toPlan(p), limits, features };
    });
  }

  async getPlanFull(planId: string): Promise<SubscriptionPlanFull | null> {
    const all = await this.getAllPlansFull();
    return all.find((p) => p.plan.id === planId) ?? null;
  }

  async createPlan(dto: CreateSubscriptionPlanDTO): Promise<SubscriptionPlan> {
    const res = await fetch('/api/admin/plans', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Could not create plan');
    }
    const body = await res.json();
    return {
      id: body.planId,
      name: dto.name,
      description: dto.description || '',
      tagline: dto.tagline || '',
      monthlyPrice: dto.monthlyPrice,
      annualPrice: dto.annualPrice,
      isActive: true,
      isDefault: false,
      displayOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async updatePlan(
    planId: string,
    dto: UpdateSubscriptionPlanDTO
  ): Promise<SubscriptionPlan | null> {
    const res = await fetch('/api/admin/plans', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, ...dto }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Could not update plan');
    }
    return null;
  }

  async deletePlan(planId: string): Promise<void> {
    const res = await fetch(`/api/admin/plans?planId=${encodeURIComponent(planId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        body?.error === 'plan_in_use'
          ? `Cannot delete: ${body.subscribers} account(s) are on this plan.`
          : body?.error || 'Could not delete plan'
      );
    }
  }

  async updateLimit(planId: string, limitKey: string, value: number): Promise<void> {
    const label = LIMIT_KEYS.find((l) => l.key === limitKey)?.label;
    const res = await fetch('/api/admin/plans', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, limitKey, limitValue: value, limitLabel: label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Could not update limit');
    }
  }

  async updateFeature(planId: string, featureKey: string, enabled: boolean): Promise<void> {
    const label = FEATURE_KEYS.find((f) => f.key === featureKey)?.label;
    const res = await fetch('/api/admin/plans', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, featureKey, enabled, featureLabel: label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Could not update feature');
    }
  }

  async getLimitForPlan(planId: string, limitKey: string): Promise<number> {
    const full = await this.getPlanFull(planId);
    return full?.limits.find((l) => l.limitKey === limitKey)?.limitValue ?? 0;
  }

  async isFeatureEnabled(planId: string, featureKey: string): Promise<boolean> {
    const full = await this.getPlanFull(planId);
    return full?.features.find((f) => f.featureKey === featureKey)?.enabled ?? false;
  }
}

export const subscriptionPlanService = new SubscriptionPlanService();
