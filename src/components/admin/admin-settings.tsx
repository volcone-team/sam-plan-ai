"use client";

import { useState, useEffect } from "react";
import { CheckCircle, Settings, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleManagement } from "./role-management";
import { LegalLinksSettings } from './legal-links-settings';
import { SupportContactSettings } from './support-contact-settings';
import { GhlSettings } from './ghl-settings';

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

/*
 * THE "FEATURE FLAGS" TAB IS GONE.
 *
 * It listed ten switches (AI Plan Generation, Weekly Operating Cadence, AI
 * Weekly Insights, Maintenance Mode and so on) with tier badges including a
 * "Mastery" tier that is not a live plan. Nothing read any of them: they were
 * seeded from a hardcoded array and written to one localStorage key that no
 * other file mentions, so toggling a flag — Maintenance Mode included —
 * changed nothing for anybody, in that admin's browser only.
 *
 * What IS real and stays elsewhere:
 *   - `plan_features` (migration 004) — the per-plan feature list customers
 *     actually see. Edited on /admin/subscriptions, read by /api/billing/me,
 *     /choose-plan, /get-started and the cancellation modal.
 *   - the `feature_flags` TABLE (migration 001) — exists, has RLS, and no
 *     code reads or writes it. Left in place; not what this tab used.
 */

interface PlatformSettings {
  appName: string;
  defaultTimezone: string;
  defaultCurrency: string;
  maxFileUploadSize: number;
  rateLimit: number;
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

const PLATFORM_SETTINGS_KEY = "sam-flow-admin-platform-settings";

const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  appName: "SAM Flow AI",
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

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function AdminSettings() {
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [showSuccess, setShowSuccess] = useState(false);
  /*
   * THE GHL TAB LIVES HERE AND NOT ON SUBSCRIPTIONS. The call gate and
   * retention sit beside the subscription because they are "what happens to a
   * customer at the edges of their subscription". The GoHighLevel sync is
   * platform plumbing — an outbox, a cron and two environment variables — and
   * its global off switch is the one the client asked for.
   */
  const [activeSettingsTab, setActiveSettingsTab] = useState<'platform' | 'roles' | 'ghl'>('platform');
  // Server-persisted, unlike the platform settings above. Applies to every visitor.
  const [deterDevtools, setDeterDevtools] = useState(false);
  const [deterError, setDeterError] = useState<string | null>(null);

  // Load from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem(PLATFORM_SETTINGS_KEY);
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch {
        // Use defaults
      }
    }
  }, []);

  // Load the server-persisted platform settings.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { credentials: 'same-origin' });
        if (!res.ok) return;
        const body = await res.json();
        if (active) setDeterDevtools(body?.deterDevtools === true);
      } catch {
        // Leave the toggle off; the error surfaces only if a save fails.
      }
    })();
    return () => { active = false; };
  }, []);

  /**
   * Persist immediately rather than waiting for Save: this setting affects all
   * users, so a silent unsaved change would be worse than an extra request. The
   * switch is moved optimistically and rolled back if the request fails.
   */
  const handleToggleDeterDevtools = async (next: boolean) => {
    setDeterDevtools(next);
    setDeterError(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deterDevtools: next }),
      });
      if (!res.ok) {
        setDeterDevtools(!next);
        setDeterError('Could not save that setting. Please try again.');
        return;
      }
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch {
      setDeterDevtools(!next);
      setDeterError('Could not reach the server. Please try again.');
    }
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
          { key: 'platform', label: 'Platform Settings', icon: Settings },
          { key: 'roles', label: 'Role Management', icon: Settings },
          { key: 'ghl', label: 'GoHighLevel', icon: Settings },
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

      {/* Platform Settings */}
      {activeSettingsTab === 'platform' && (
      <section aria-label="Platform Settings">
        {/*
          Browser inspection deterrent. Unlike the platform settings below
          (localStorage-only, affecting nobody but the admin's own browser),
          this is persisted server-side and applies to every visitor, so it
          saves immediately rather than waiting for the Save button below.
        */}
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Browser Protection</h2>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Discourage page inspection
                </p>
                <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                  Blocks right-click and the F12 / Ctrl+Shift+I / Ctrl+U shortcuts for
                  all users.
                </p>
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  A deterrent only, not a security measure. Browser code is always
                  readable — via view-source, the browser menu, or with JavaScript
                  disabled — so treat nothing in the frontend as private. It also gets
                  in the way of debugging, so leave it off unless you want it for demos.
                </p>
                {deterError && (
                  <p className="mt-2 text-xs text-[hsl(var(--destructive))]" role="alert">
                    {deterError}
                  </p>
                )}
              </div>
              <ToggleSwitch
                checked={deterDevtools}
                onChange={handleToggleDeterDevtools}
                ariaLabel="Toggle inspection deterrent"
              />
            </div>
          </div>
        </div>

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

            {/* Support Email moved to <SupportContactSettings /> (server-saved, drives the footer). */}

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

      {/*
        Legal links, on the Platform tab beside the other app_settings values.
        Separate component because it owns its own load, validation and save —
        folding it into handleSaveSettings would couple the signup checkbox's
        links to a form that also writes unrelated settings.
      */}
      {activeSettingsTab === 'platform' && (
      <section aria-label="Support contact" className="mt-6">
        <SupportContactSettings />
      </section>
      )}

      {activeSettingsTab === 'platform' && (
      <section aria-label="Legal links" className="mt-6">
        <LegalLinksSettings />
      </section>
      )}

      {/* Role Management */}
      {activeSettingsTab === 'roles' && (
      <section aria-label="Role Management">
        <RoleManagement />
      </section>
      )}

      {/*
        GoHighLevel. Mounted only when its tab is active, so the panel's three
        requests (settings, outbox counts, delivery log) are not fired at every
        admin who opens this page to change the support email.
      */}
      {activeSettingsTab === 'ghl' && (
      <section aria-label="GoHighLevel sync">
        <GhlSettings />
      </section>
      )}
    </div>
  );
}
