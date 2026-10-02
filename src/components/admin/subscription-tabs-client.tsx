'use client';

import { useState } from 'react';
import { CreditCard, Settings, Zap } from 'lucide-react';
import { SubscriptionOverview } from './subscription-overview';
import { SubscriptionPlanEditor } from './subscription-plan-editor';
import { BillingManagement } from './billing-management';

type SubTab = 'overview' | 'billing' | 'manage-plans';

/**
 * Overview now shows REAL revenue aggregates (it was a hardcoded mock), so it is
 * the default again. Billing & Stripe holds the controls and per-account detail.
 */
export function SubscriptionTabsClient() {
  const [activeTab, setActiveTab] = useState<SubTab>('overview');

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: CreditCard },
    { key: 'billing' as const, label: 'Billing & Stripe', icon: Zap },
    { key: 'manage-plans' as const, label: 'Manage Plans', icon: Settings },
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

      {activeTab === 'overview' && <SubscriptionOverview />}
      {activeTab === 'billing' && <BillingManagement />}
      {activeTab === 'manage-plans' && <SubscriptionPlanEditor />}
    </div>
  );
}
