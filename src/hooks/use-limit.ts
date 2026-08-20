'use client';

import { useState, useEffect } from 'react';
import { subscriptionPlanService } from '@/services/subscription-plan.service';
import type { LimitKey } from '@/types/subscription-plan.types';

/**
 * Current user's plan ID.
 * TODO: Replace with actual subscription from Supabase auth context.
 */
const CURRENT_PLAN_ID = 'plan-pro';

interface LimitStatus {
  max: number;        // -1 = unlimited, 0 = disabled, >0 = capped
  isUnlimited: boolean;
  isDisabled: boolean;
  loading: boolean;
}

/**
 * Hook to check the limit for a specific key on the current user's plan.
 *
 * Usage:
 *   const { max, isUnlimited, isDisabled } = useLimit('max_users');
 *   // Then compare with current count to see if at limit
 */
export function useLimit(limitKey: LimitKey | string): LimitStatus {
  const [status, setStatus] = useState<LimitStatus>({
    max: -1,
    isUnlimited: true,
    isDisabled: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    subscriptionPlanService.getLimitForPlan(CURRENT_PLAN_ID, limitKey).then(value => {
      if (!cancelled) {
        setStatus({
          max: value,
          isUnlimited: value === -1,
          isDisabled: value === 0,
          loading: false,
        });
      }
    });

    return () => { cancelled = true; };
  }, [limitKey]);

  return status;
}

/**
 * Hook to check if a feature is enabled on the current plan.
 *
 * Usage:
 *   const hasAnalytics = useFeatureEnabled('advanced_analytics');
 */
export function useFeatureEnabled(featureKey: string): boolean {
  const [enabled, setEnabled] = useState(true); // Default true for dev

  useEffect(() => {
    let cancelled = false;

    subscriptionPlanService.isFeatureEnabled(CURRENT_PLAN_ID, featureKey).then(result => {
      if (!cancelled) setEnabled(result);
    });

    return () => { cancelled = true; };
  }, [featureKey]);

  return enabled;
}
