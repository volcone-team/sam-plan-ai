'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, ChevronDown, ChevronRight, Check, Trash2, DollarSign } from 'lucide-react';
import { subscriptionPlanService } from '@/services/subscription-plan.service';
import { LIMIT_KEYS, FEATURE_KEYS } from '@/types/subscription-plan.types';
import type { SubscriptionPlanFull } from '@/types/subscription-plan.types';

/**
 * Admin Subscription Plans Editor.
 * Allows admin to configure plans, limits, and features.
 */
export function SubscriptionPlanEditor() {
  const [plans, setPlans] = useState<SubscriptionPlanFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPlan, setNewPlan] = useState({ name: '', monthlyPrice: '', annualPrice: '' });

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const data = await subscriptionPlanService.getAllPlansFull();
      setPlans(data);
      if (data.length > 0 && !expandedPlan) setExpandedPlan(data[0].plan.id);
    } catch (err) {
      console.error('Failed to load plans:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlan.name.trim()) return;
    await subscriptionPlanService.createPlan({
      name: newPlan.name.trim(),
      monthlyPrice: parseFloat(newPlan.monthlyPrice) || 0,
      annualPrice: parseFloat(newPlan.annualPrice) || 0,
    });
    setNewPlan({ name: '', monthlyPrice: '', annualPrice: '' });
    setShowAddForm(false);
    loadPlans();
  };

  const handleDeletePlan = async (planId: string) => {
    if (!confirm('Delete this plan? This cannot be undone.')) return;
    await subscriptionPlanService.deletePlan(planId);
    loadPlans();
  };

  const handleUpdatePrice = async (planId: string, field: 'monthlyPrice' | 'annualPrice', value: string) => {
    const num = parseFloat(value) || 0;
    await subscriptionPlanService.updatePlan(planId, { [field]: num });
    setPlans(prev => prev.map(p =>
      p.plan.id === planId ? { ...p, plan: { ...p.plan, [field]: num } } : p
    ));
  };

  const handleUpdateLimit = async (planId: string, limitKey: string, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    await subscriptionPlanService.updateLimit(planId, limitKey, num);
    setPlans(prev => prev.map(p =>
      p.plan.id === planId
        ? { ...p, limits: p.limits.map(l => l.limitKey === limitKey ? { ...l, limitValue: num } : l) }
        : p
    ));
  };

  const handleToggleFeature = async (planId: string, featureKey: string, current: boolean) => {
    await subscriptionPlanService.updateFeature(planId, featureKey, !current);
    setPlans(prev => prev.map(p =>
      p.plan.id === planId
        ? { ...p, features: p.features.map(f => f.featureKey === featureKey ? { ...f, enabled: !current } : f) }
        : p
    ));
  };

  const handleToggleActive = async (planId: string, current: boolean) => {
    await subscriptionPlanService.updatePlan(planId, { isActive: !current });
    setPlans(prev => prev.map(p =>
      p.plan.id === planId ? { ...p, plan: { ...p.plan, isActive: !current } } : p
    ));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Subscription Plans</h2>
          <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
            Configure pricing, limits, and features for each plan. Changes apply to new subscriptions.
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add Plan
          </button>
        )}
      </div>

      {/* Add plan form */}
      {showAddForm && (
        <form onSubmit={handleAddPlan} className="rounded-[var(--radius-lg)] border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium">New Subscription Plan</h3>
          <div className="grid grid-cols-3 gap-3">
            <input type="text" required value={newPlan.name} onChange={e => setNewPlan(p => ({ ...p, name: e.target.value }))} placeholder="Plan name" className="rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
            <input type="number" min="0" value={newPlan.monthlyPrice} onChange={e => setNewPlan(p => ({ ...p, monthlyPrice: e.target.value }))} placeholder="Monthly $" className="rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
            <input type="number" min="0" value={newPlan.annualPrice} onChange={e => setNewPlan(p => ({ ...p, annualPrice: e.target.value }))} placeholder="Annual $" className="rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-xs border border-border rounded-[var(--radius-md)]">Cancel</button>
            <button type="submit" className="px-3 py-1.5 text-xs bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-[var(--radius-md)]">Create</button>
          </div>
        </form>
      )}

      {/* Plans list */}
      {plans.map(({ plan, limits, features }) => {
        const isExpanded = expandedPlan === plan.id;
        return (
          <div key={plan.id} className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
            {/* Plan header */}
            <button
              onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
              className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-[hsl(var(--background-muted))] transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown className="h-4 w-4 text-[hsl(var(--foreground-muted))]" /> : <ChevronRight className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[hsl(var(--foreground))]">{plan.name}</span>
                    {!plan.isActive && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">Inactive</span>
                    )}
                    {plan.tagline && (
                      <span className="rounded-full bg-[hsl(var(--primary)_/_0.1)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">{plan.tagline}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{plan.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-[hsl(var(--foreground-muted))]">${plan.monthlyPrice}/mo</span>
                <span className="text-[hsl(var(--foreground-muted))]">${plan.annualPrice}/yr</span>
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-border px-5 py-4 space-y-5">
                {/* Pricing */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))] mb-2 flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5" /> Pricing
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-[hsl(var(--foreground-muted))]">Monthly price ($)</label>
                      <input
                        type="number" min="0" step="1"
                        defaultValue={plan.monthlyPrice}
                        onBlur={e => handleUpdatePrice(plan.id, 'monthlyPrice', e.target.value)}
                        className="w-full mt-1 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[hsl(var(--foreground-muted))]">Annual price ($)</label>
                      <input
                        type="number" min="0" step="1"
                        defaultValue={plan.annualPrice}
                        onBlur={e => handleUpdatePrice(plan.id, 'annualPrice', e.target.value)}
                        className="w-full mt-1 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]"
                      />
                    </div>
                  </div>
                </div>

                {/* Limits */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))] mb-2">
                    Usage Limits
                  </h4>
                  <p className="text-[11px] text-[hsl(var(--foreground-muted))] mb-2">Use -1 for unlimited, 0 for disabled.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {LIMIT_KEYS.map(lk => {
                      const limit = limits.find(l => l.limitKey === lk.key);
                      return (
                        <div key={lk.key}>
                          <label className="text-[11px] text-[hsl(var(--foreground-muted))]">{lk.label}</label>
                          <input
                            type="number"
                            defaultValue={limit?.limitValue ?? 0}
                            onBlur={e => handleUpdateLimit(plan.id, lk.key, e.target.value)}
                            className="w-full mt-1 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Features */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))] mb-2">
                    Features
                  </h4>
                  <div className="grid grid-cols-2 gap-1">
                    {FEATURE_KEYS.map(fk => {
                      const feature = features.find(f => f.featureKey === fk.key);
                      const enabled = feature?.enabled ?? false;
                      return (
                        <label key={fk.key} className="flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-sm cursor-pointer hover:bg-[hsl(var(--background-muted))]">
                          <div
                            onClick={() => handleToggleFeature(plan.id, fk.key, enabled)}
                            className={`flex h-4 w-4 items-center justify-center rounded border transition-colors cursor-pointer ${
                              enabled ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]' : 'border-border bg-background'
                            }`}
                          >
                            {enabled && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-[hsl(var(--foreground))]">{fk.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <button
                    onClick={() => handleToggleActive(plan.id, plan.isActive)}
                    className={`text-xs font-medium ${plan.isActive ? 'text-amber-600 hover:text-amber-700' : 'text-[hsl(var(--primary))] hover:underline'}`}
                  >
                    {plan.isActive ? 'Deactivate Plan' : 'Activate Plan'}
                  </button>
                  <button
                    onClick={() => handleDeletePlan(plan.id)}
                    className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
