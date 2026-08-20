'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Crown } from 'lucide-react';
import { subscriptionPlanService } from '@/services/subscription-plan.service';
import type { SubscriptionPlanFull } from '@/types/subscription-plan.types';

// TODO: Replace with actual user subscription from Supabase
const CURRENT_PLAN_ID = 'plan-pro';

export function SubscriptionSettings() {
  const [plans, setPlans] = useState<SubscriptionPlanFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await subscriptionPlanService.getAllPlansFull();
        setPlans(data.filter(p => p.plan.isActive));
      } catch (err) {
        console.error('Failed to load plans:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleUpgrade = (planId: string) => {
    if (planId === CURRENT_PLAN_ID) return;
    setShowAlert(true);
    setTimeout(() => setShowAlert(false), 3000);
  };

  const formatLimit = (value: number): string => {
    if (value === -1) return 'Unlimited';
    if (value === 0) return '—';
    return value.toString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading plans...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alert */}
      {showAlert && (
        <div className="rounded-[var(--radius-md)] border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          Billing coming soon — Stripe integration is planned for a future release.
        </div>
      )}

      {/* Plan Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map(({ plan, limits, features }) => {
          const isCurrent = plan.id === CURRENT_PLAN_ID;
          const currentIdx = plans.findIndex(p => p.plan.id === CURRENT_PLAN_ID);
          const thisIdx = plans.findIndex(p => p.plan.id === plan.id);
          const isHigher = thisIdx > currentIdx;

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-[var(--radius-lg)] border p-6 ${
                isCurrent
                  ? 'border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))] bg-card'
                  : 'border-border bg-card'
              }`}
            >
              {/* Current Plan Badge */}
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[hsl(var(--primary))] px-3 py-0.5 text-xs font-medium text-[hsl(var(--primary-foreground))]">
                  Current Plan
                </div>
              )}

              {/* Header */}
              <div className="mb-4 flex items-center gap-2">
                <Crown className="h-5 w-5 text-[hsl(var(--primary))]" />
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                {plan.tagline && (
                  <span className="ml-auto rounded-full bg-[hsl(var(--primary)_/_0.1)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">
                    {plan.tagline}
                  </span>
                )}
              </div>

              {/* Pricing */}
              <div className="mb-2">
                {plan.monthlyPrice > 0 && (
                  <span className="text-2xl font-bold">${plan.monthlyPrice}/mo</span>
                )}
                {plan.monthlyPrice > 0 && plan.annualPrice > 0 && (
                  <span className="text-sm text-[hsl(var(--foreground-muted))]"> · </span>
                )}
                <span className={plan.monthlyPrice > 0 ? 'text-sm text-[hsl(var(--foreground-muted))]' : 'text-2xl font-bold'}>
                  ${plan.annualPrice.toLocaleString()}/yr
                </span>
              </div>

              {/* Description */}
              <p className="mb-4 text-sm text-[hsl(var(--foreground-muted))]">
                {plan.description}
              </p>

              {/* Limits */}
              <div className="mb-4 space-y-1.5">
                {limits.map(limit => (
                  <div key={limit.limitKey} className="flex items-center justify-between text-xs">
                    <span className="text-[hsl(var(--foreground-muted))]">{limit.limitLabel}</span>
                    <span className="font-medium text-[hsl(var(--foreground))]">{formatLimit(limit.limitValue)}</span>
                  </div>
                ))}
              </div>

              {/* Features */}
              <ul className="mb-6 flex-1 space-y-1.5">
                {features.filter(f => f.enabled).map(feature => (
                  <li key={feature.featureKey} className="flex items-center gap-2 text-sm">
                    <Check className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
                    {feature.featureLabel}
                  </li>
                ))}
              </ul>

              {/* Action Button */}
              <button
                onClick={() => handleUpgrade(plan.id)}
                disabled={isCurrent}
                className={`w-full rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium transition-opacity ${
                  isCurrent
                    ? 'cursor-default border border-border bg-background text-[hsl(var(--foreground-muted))]'
                    : isHigher
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
                      : 'border border-border bg-background text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background-muted))]'
                }`}
              >
                {isCurrent ? 'Current Plan' : isHigher ? 'Upgrade' : 'Downgrade'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Billing Placeholder */}
      <div className="rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
        Manage billing will be available once Stripe is connected.
      </div>
    </div>
  );
}
