'use client';

import type { ReactNode } from 'react';
import { useLimit, useFeatureEnabled } from '@/hooks/use-limit';
import { ArrowUpCircle } from 'lucide-react';
import Link from 'next/link';

interface LimitGateProps {
  /**
   * The limit key to check (e.g. 'max_users', 'max_initiatives')
   */
  limitKey: string;
  /**
   * Current usage count — if >= max, shows upgrade prompt
   */
  currentCount: number;
  /**
   * Content to show when under the limit
   */
  children: ReactNode;
  /**
   * Optional custom message when limit is hit
   */
  message?: string;
}

/**
 * Wrapper that shows an upgrade prompt when a usage limit is reached.
 *
 * Usage:
 *   <LimitGate limitKey="max_users" currentCount={teamMembers.length}>
 *     <button>Invite Member</button>
 *   </LimitGate>
 */
export function LimitGate({ limitKey, currentCount, children, message }: LimitGateProps) {
  const { max, isUnlimited, isDisabled, loading } = useLimit(limitKey);

  if (loading) return <>{children}</>;

  // Unlimited — always show
  if (isUnlimited) return <>{children}</>;

  // Disabled — show upgrade prompt
  if (isDisabled) {
    return <UpgradePrompt message={message || 'This feature is not available on your current plan.'} />;
  }

  // At or over limit
  if (currentCount >= max) {
    return <UpgradePrompt message={message || `You've reached the limit of ${max}. Upgrade your plan for more.`} />;
  }

  // Under limit — show content
  return <>{children}</>;
}

interface FeatureGateProps {
  /**
   * The feature key to check (e.g. 'advanced_analytics')
   */
  featureKey: string;
  /**
   * Content to show when feature is enabled
   */
  children: ReactNode;
  /**
   * Optional custom message
   */
  message?: string;
}

/**
 * Wrapper that shows upgrade prompt when a feature is not enabled on the current plan.
 *
 * Usage:
 *   <FeatureGate featureKey="advanced_analytics">
 *     <AnalyticsSection />
 *   </FeatureGate>
 */
export function FeatureGate({ featureKey, children, message }: FeatureGateProps) {
  const enabled = useFeatureEnabled(featureKey);

  if (!enabled) {
    return <UpgradePrompt message={message || 'This feature is available on a higher plan.'} />;
  }

  return <>{children}</>;
}

function UpgradePrompt({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.05)] px-4 py-3 flex items-center gap-3">
      <ArrowUpCircle className="h-5 w-5 shrink-0 text-[hsl(var(--primary))]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[hsl(var(--foreground))]">{message}</p>
      </div>
      <Link
        href="/settings"
        className="shrink-0 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
      >
        Upgrade
      </Link>
    </div>
  );
}
