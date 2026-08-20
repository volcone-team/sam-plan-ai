'use client';

import { useState } from 'react';
import { Building2, User, CreditCard, BarChart3, Users } from 'lucide-react';
import { CompanySettings } from './company-settings';
import { UserProfile } from './user-profile';
import { SubscriptionSettings } from './subscription-settings';
import { BenchmarkSettings } from './benchmark-settings';
import { TeamMembers } from './team-members';

type SettingsTab = 'company' | 'profile' | 'team' | 'subscription' | 'benchmarks';

const TABS: { id: SettingsTab; label: string; icon: typeof Building2 }[] = [
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team Members', icon: Users },
  { id: 'subscription', label: 'Subscription', icon: CreditCard },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3 },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('company');

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Settings tabs">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                    : 'border-transparent text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        {activeTab === 'company' && <CompanySettings />}
        {activeTab === 'profile' && <UserProfile />}
        {activeTab === 'team' && <TeamMembers />}
        {activeTab === 'subscription' && <SubscriptionSettings />}
        {activeTab === 'benchmarks' && <BenchmarkSettings />}
      </div>
    </div>
  );
}
