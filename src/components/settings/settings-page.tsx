'use client';

import { useState, type ReactNode } from 'react';
import {
  Building2,
  User,
  CreditCard,
  BarChart3,
  Users,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { roleHasPermission, type Permission } from '@/lib/permissions';
import { CompanySettings } from './company-settings';
import { UserProfile } from './user-profile';
import { SubscriptionSettings } from './subscription-settings';
import { BenchmarkSettings } from './benchmark-settings';
import { TeamMembers } from './team-members';

type SettingsTab = 'company' | 'profile' | 'team' | 'subscription' | 'benchmarks' | 'intake';

/**
 * `requires` is the permission needed to SEE the tab, not merely to act in it.
 *
 * Two of these were visible to every member. Subscription showed the plan,
 * the price, the invoice history and a cancel button to anyone who opened
 * Settings; Team Members showed the whole invite and role-editing surface,
 * where every control would have been refused by the server with a 403. The
 * write paths were safe, but offering them at all is both a disclosure and a
 * stream of dead buttons.
 *
 * `undefined` means everyone: Profile is the person's own account, and Company
 * and Benchmarks are gated inside their own components where an operator has
 * legitimate partial access. Intake answers is read-only company data every
 * member may see.
 */
const TABS: {
  id: SettingsTab;
  label: string;
  icon: typeof Building2;
  requires?: Permission;
}[] = [
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'team', label: 'Team Members', icon: Users, requires: 'settings.manage_team' },
  { id: 'subscription', label: 'Subscription', icon: CreditCard, requires: 'settings.billing' },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3 },
  { id: 'intake', label: 'Intake answers', icon: ClipboardList },
];

function isSettingsTab(value: string | undefined): value is SettingsTab {
  return TABS.some((tab) => tab.id === value);
}

export function SettingsPage({
  initialTab,
  intakeAnswers,
}: {
  initialTab?: string;
  /** Server-rendered "Intake answers" panel, passed in as a slot. */
  intakeAnswers?: ReactNode;
} = {}) {
  const { role, loading } = useAuth();

  const visibleTabs = TABS.filter(
    (tab) => !tab.requires || roleHasPermission(role, tab.requires)
  );

  // An unknown or not-permitted tab falls through `resolvedTab` below.
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    isSettingsTab(initialTab) ? initialTab : 'company'
  );

  /**
   * Never render a tab the viewer cannot see.
   *
   * `activeTab` is plain state, so it can hold a value that is no longer in
   * `visibleTabs` — most obviously on first paint, when `role` has not loaded
   * and nothing privileged is visible yet. Resolving it here rather than in an
   * effect avoids a frame where the content and the highlighted tab disagree,
   * and avoids a setState-in-effect cascade.
   */
  const resolvedTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : visibleTabs[0]?.id ?? 'profile';

  /**
   * Held until the role is known.
   *
   * Rendering first would show the restricted tabs for a moment to everyone,
   * because `roleHasPermission(null, …)` is false only AFTER the role arrives —
   * before that there is nothing to check against, and a flash of the
   * Subscription tab is exactly the disclosure this is meant to prevent.
   */
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2
          className="h-5 w-5 animate-spin text-[hsl(var(--foreground-muted))]"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Settings tabs">
          {visibleTabs.map(tab => {
            const isActive = resolvedTab === tab.id;
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
        {resolvedTab === 'company' && <CompanySettings />}
        {resolvedTab === 'profile' && <UserProfile />}
        {resolvedTab === 'team' && <TeamMembers />}
        {resolvedTab === 'subscription' && <SubscriptionSettings />}
        {resolvedTab === 'benchmarks' && <BenchmarkSettings />}
        {resolvedTab === 'intake' && intakeAnswers}
      </div>
    </div>
  );
}
