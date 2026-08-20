'use client';

import { useState } from 'react';
import { CreditCard, Settings } from 'lucide-react';
import { SubscriptionManagement } from './subscription-management';
import { SubscriptionPlanEditor } from './subscription-plan-editor';

type SubTab = 'overview' | 'manage-plans';

export function SubscriptionTabsClient() {
  const [activeTab, setActiveTab] = useState<SubTab>('overview');

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
              : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          Overview
        </button>
        <button
          onClick={() => setActiveTab('manage-plans')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'manage-plans'
              ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
              : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <Settings className="h-4 w-4" />
          Manage Plans
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <SubscriptionManagement />}
      {activeTab === 'manage-plans' && <SubscriptionPlanEditor />}
    </div>
  );
}
