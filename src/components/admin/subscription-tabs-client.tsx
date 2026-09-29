'use client';

import { useState } from 'react';
import { CreditCard, Settings, Zap } from 'lucide-react';
import { SubscriptionManagement } from './subscription-management';
import { SubscriptionPlanEditor } from './subscription-plan-editor';
import { BillingManagement } from './billing-management';

type SubTab = 'billing' | 'overview' | 'manage-plans';

/**
 * Billing is the DEFAULT tab: it is the only one backed by real Stripe data.
 * 'Overview' is the original mock panel, kept for its layout but clearly labelled
 * as sample data so nobody mistakes its numbers for real revenue.
 */
export function SubscriptionTabsClient() {
  const [activeTab, setActiveTab] = useState<SubTab>('billing');

  const tabs = [
    { key: 'billing' as const, label: 'Billing & Stripe', icon: Zap },
    { key: 'manage-plans' as const, label: 'Manage Plans', icon: Settings },
    { key: 'overview' as const, label: 'Overview (sample)', icon: CreditCard },
  ];

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'billing' && <BillingManagement />}
      {activeTab === 'manage-plans' && <SubscriptionPlanEditor />}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            This tab shows placeholder figures from the original prototype, not real
            data. Use the Billing &amp; Stripe tab for actual subscribers and payments.
          </div>
          <SubscriptionManagement />
        </div>
      )}
    </div>
  );
}
