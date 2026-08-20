"use client";

import { useState, useEffect } from "react";
import { CheckCircle, Settings, ToggleLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleManagement } from "./role-management";
import { InternalTeamManagement } from "./internal-team-management";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

type TierRestriction = "All" | "Starter+" | "Pro+" | "Mastery";

interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tier: TierRestriction;
}

interface PlatformSettings {
  appName: string;
  supportEmail: string;
  defaultTimezone: string;
  defaultCurrency: string;
  maxFileUploadSize: number;
  rateLimit: number;
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

const FEATURE_FLAGS_KEY = "sam-flow-admin-feature-flags";
const PLATFORM_SETTINGS_KEY = "sam-flow-admin-platform-settings";

const DEFAULT_FLAGS: FeatureFlag[] = [
  { id: "ai-plan-generation", name: "AI Plan Generation", description: "Generate plans from questionnaire answers", enabled: true, tier: "All" },
  { id: "weekly-operating-cadence", name: "Weekly Operating Cadence", description: "Weekly planner with 5-step flow", enabled: true, tier: "All" },
  { id: "revenue-projections", name: "Revenue Projections", description: "Good/Better/Best scenario projections", enabled: true, tier: "All" },
  { id: "csv-export", name: "CSV Export", description: "Export reports as CSV files", enabled: true, tier: "Pro+" },
  { id: "advanced-analytics", name: "Advanced Analytics", description: "Detailed analytics and trend reports", enabled: false, tier: "Pro+" },
  { id: "custom-initiative-types", name: "Custom Initiative Types", description: "Users can create custom initiative types", enabled: false, tier: "Mastery" },
  { id: "ai-weekly-insights", name: "AI Weekly Insights", description: "AI-generated weekly performance insights", enabled: false, tier: "Pro+" },
  { id: "benchmark-contribution", name: "Benchmark Contribution", description: "Users contribute anonymized data to benchmarks", enabled: true, tier: "All" },
  { id: "multi-user-access", name: "Multi-User Access", description: "Multiple users per company", enabled: false, tier: "Pro+" },
  { id: "maintenance-mode", name: "Maintenance Mode", description: "Show maintenance screen to all users", enabled: false, tier: "All" },
];

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  appName: "SAM Flow AI",
  supportEmail: "",
  defaultTimezone: "America/New_York",
  defaultCurrency: "USD",
  maxFileUploadSize: 10,
  rateLimit: 60,
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function getTierBadgeClasses(tier: TierRestriction): string {
  switch (tier) {
    case "All":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    case "Starter+":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "Pro+":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    case "Mastery":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
  }
}

/* ------------------------------------------------------------------
   Sub-components
   ------------------------------------------------------------------ */

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

function FeatureFlagRow({
  flag,
  onToggle,
}: {
  flag: FeatureFlag;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">{flag.name}</p>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              getTierBadgeClasses(flag.tier)
            )}
          >
            {flag.tier}
          </span>
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            {flag.tier === "All" ? "Global" : `${flag.tier} only`}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{flag.description}</p>
      </div>
      <ToggleSwitch
        checked={flag.enabled}
        onChange={() => onToggle(flag.id)}
        ariaLabel={`Toggle ${flag.name}`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function AdminSettings() {
  const [flags, setFlags] = useState<FeatureFlag[]>(DEFAULT_FLAGS);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [showSuccess, setShowSuccess] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'flags' | 'platform' | 'roles' | 'team'>('flags');

  // Load from localStorage
  useEffect(() => {
    const savedFlags = localStorage.getItem(FEATURE_FLAGS_KEY);
    if (savedFlags) {
      try {
        setFlags(JSON.parse(savedFlags));
      } catch {
        // Use defaults
      }
    }

    const savedSettings = localStorage.getItem(PLATFORM_SETTINGS_KEY);
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch {
        // Use defaults
      }
    }
  }, []);

  // Toggle a feature flag
  const handleToggleFlag = (id: string) => {
    setFlags((prev) => {
      const updated = prev.map((f) =>
        f.id === id ? { ...f, enabled: !f.enabled } : f
      );
      localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // Save platform settings
  const handleSaveSettings = () => {
    localStorage.setItem(PLATFORM_SETTINGS_KEY, JSON.stringify(settings));
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Success Toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle className="h-4 w-4" />
          Platform settings saved successfully.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {([
          { key: 'flags', label: 'Feature Flags', icon: ToggleLeft },
          { key: 'platform', label: 'Platform Settings', icon: Settings },
          { key: 'roles', label: 'Role Management', icon: Settings },
          { key: 'team', label: 'Internal Team', icon: Settings },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveSettingsTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeSettingsTab === tab.key
                ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeSettingsTab === 'flags' && (
        <section aria-label="Feature Flags">
        <div className="mb-4 flex items-center gap-2">
          <ToggleLeft className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Feature Flags</h2>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="divide-y divide-border">
            {flags.map((flag) => (
              <FeatureFlagRow key={flag.id} flag={flag} onToggle={handleToggleFlag} />
            ))}
          </div>
        </div>
      </section>
      )}

      {/* Platform Settings */}
      {activeSettingsTab === 'platform' && (
      <section aria-label="Platform Settings">
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Platform Settings</h2>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* App Name */}
            <div>
              <label
                htmlFor="app-name"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                App Name
              </label>
              <input
                id="app-name"
                type="text"
                value={settings.appName}
                onChange={(e) => setSettings((s) => ({ ...s, appName: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                placeholder="SAM Flow AI"
              />
            </div>

            {/* Support Email */}
            <div>
              <label
                htmlFor="support-email"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Support Email
              </label>
              <input
                id="support-email"
                type="email"
                value={settings.supportEmail}
                onChange={(e) => setSettings((s) => ({ ...s, supportEmail: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                placeholder="support@samflow.ai"
              />
            </div>

            {/* Default Timezone */}
            <div>
              <label
                htmlFor="timezone"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Default Timezone
              </label>
              <select
                id="timezone"
                value={settings.defaultTimezone}
                onChange={(e) => setSettings((s) => ({ ...s, defaultTimezone: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Default Currency */}
            <div>
              <label
                htmlFor="currency"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Default Currency
              </label>
              <select
                id="currency"
                value={settings.defaultCurrency}
                onChange={(e) => setSettings((s) => ({ ...s, defaultCurrency: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              >
                {CURRENCIES.map((cur) => (
                  <option key={cur} value={cur}>
                    {cur}
                  </option>
                ))}
              </select>
            </div>

            {/* Max File Upload Size */}
            <div>
              <label
                htmlFor="max-upload"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Max File Upload Size (MB)
              </label>
              <input
                id="max-upload"
                type="number"
                min={1}
                max={100}
                value={settings.maxFileUploadSize}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, maxFileUploadSize: Number(e.target.value) }))
                }
                className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>

            {/* Rate Limit */}
            <div>
              <label
                htmlFor="rate-limit"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Rate Limit (requests/min)
              </label>
              <input
                id="rate-limit"
                type="number"
                min={1}
                max={1000}
                value={settings.rateLimit}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, rateLimit: Number(e.target.value) }))
                }
                className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>

          {/* Save Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSaveSettings}
              className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[hsl(var(--primary)/0.9)]"
            >
              Save Settings
            </button>
          </div>
        </div>
      </section>
      )}

      {/* Role Management */}
      {activeSettingsTab === 'roles' && (
      <section aria-label="Role Management">
        <RoleManagement />
      </section>
      )}

      {/* Internal Team */}
      {activeSettingsTab === 'team' && (
      <section aria-label="Internal Team">
        <InternalTeamManagement />
      </section>
      )}
    </div>
  );
}
