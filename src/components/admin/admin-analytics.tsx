"use client";

import { useState } from "react";
import {
  Users,
  BarChart3,
  Sparkles,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  TrendingUp,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

type TabId = "users" | "features" | "ai" | "activity";

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Users;
}

type ActivityType = "user" | "system" | "admin";

interface ActivityEntry {
  id: number;
  type: ActivityType;
  message: string;
  timestamp: string;
  actor: string;
}

/* ------------------------------------------------------------------
   Mock Data
   ------------------------------------------------------------------ */

const tabs: Tab[] = [
  { id: "users", label: "User Analytics", icon: Users },
  { id: "features", label: "Feature Usage", icon: BarChart3 },
  { id: "ai", label: "AI Analytics", icon: Sparkles },
  { id: "activity", label: "Activity Log", icon: Activity },
];

const funnelData = [
  { label: "Started", value: 5 },
  { label: "Completed", value: 3 },
  { label: "Generated", value: 2 },
  { label: "First Result", value: 1 },
];

const featureUsageData = [
  { page: "Year-at-a-Glance", views: 45 },
  { page: "Initiatives", views: 38 },
  { page: "Weekly", views: 32 },
  { page: "Reports", views: 28 },
  { page: "Quarterly", views: 22 },
  { page: "Settings", views: 15 },
  { page: "Calendar", views: 12 },
];

const aiLogData = [
  { timestamp: "2024-01-15 14:32", user: "Sarah M.", promptType: "Plan Generation", tokens: 3240, status: "success" as const },
  { timestamp: "2024-01-15 13:15", user: "John D.", promptType: "Initiative Suggestion", tokens: 1850, status: "success" as const },
  { timestamp: "2024-01-15 11:48", user: "Sarah M.", promptType: "Weekly Plan", tokens: 2100, status: "success" as const },
  { timestamp: "2024-01-15 10:22", user: "Mike R.", promptType: "Plan Generation", tokens: 3450, status: "failed" as const },
  { timestamp: "2024-01-15 09:05", user: "John D.", promptType: "Report Summary", tokens: 1810, status: "success" as const },
];

const activityLogData: ActivityEntry[] = [
  { id: 1, type: "user", message: "Sarah M. generated a new marketing plan", timestamp: "2 min ago", actor: "Sarah M." },
  { id: 2, type: "system", message: "AI model updated to v2.1", timestamp: "15 min ago", actor: "System" },
  { id: 3, type: "admin", message: "Admin updated initiative library", timestamp: "1 hour ago", actor: "Admin" },
  { id: 4, type: "user", message: "John D. completed onboarding", timestamp: "2 hours ago", actor: "John D." },
  { id: 5, type: "system", message: "Daily backup completed successfully", timestamp: "3 hours ago", actor: "System" },
  { id: 6, type: "user", message: "Mike R. viewed quarterly plan", timestamp: "4 hours ago", actor: "Mike R." },
  { id: 7, type: "admin", message: "Admin added new benchmark data", timestamp: "5 hours ago", actor: "Admin" },
  { id: 8, type: "system", message: "Cache cleared automatically", timestamp: "6 hours ago", actor: "System" },
  { id: 9, type: "user", message: "Sarah M. exported report to PDF", timestamp: "7 hours ago", actor: "Sarah M." },
  { id: 10, type: "admin", message: "Admin modified subscription tiers", timestamp: "8 hours ago", actor: "Admin" },
  { id: 11, type: "user", message: "John D. updated company profile", timestamp: "10 hours ago", actor: "John D." },
  { id: 12, type: "system", message: "SSL certificate renewed", timestamp: "12 hours ago", actor: "System" },
  { id: 13, type: "user", message: "Mike R. started onboarding flow", timestamp: "1 day ago", actor: "Mike R." },
  { id: 14, type: "admin", message: "Admin created new questionnaire", timestamp: "1 day ago", actor: "Admin" },
  { id: 15, type: "system", message: "Scheduled maintenance completed", timestamp: "2 days ago", actor: "System" },
];

/* ------------------------------------------------------------------
   Sub-components
   ------------------------------------------------------------------ */

function MetricCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Users }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">{label}</p>
        <Icon className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
      </div>
      <p className="mt-2 text-3xl font-bold text-[hsl(var(--foreground))]">{value}</p>
    </div>
  );
}

function UserAnalyticsTab() {
  return (
    <div className="space-y-8">
      {/* DAU / WAU / MAU */}
      <section aria-label="User engagement metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Daily Active Users" value={2} icon={Users} />
          <MetricCard label="Weekly Active Users" value={3} icon={TrendingUp} />
          <MetricCard label="Monthly Active Users" value={3} icon={BarChart3} />
        </div>
      </section>

      {/* Activation Rate */}
      <section aria-label="Activation rate">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Activation Rate</p>
              <p className="mt-1 text-3xl font-bold text-[hsl(var(--foreground))]">33%</p>
            </div>
            <Zap className="h-8 w-8 text-[hsl(var(--primary))]" />
          </div>
          <div className="mt-4 h-2 w-full rounded-full bg-[hsl(var(--foreground-muted)/0.2)]">
            <div className="h-2 rounded-full bg-[hsl(var(--primary))]" style={{ width: "33%" }} />
          </div>
        </div>
      </section>

      {/* Funnel */}
      <section aria-label="User funnel">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <h3 className="mb-4 text-base font-semibold text-[hsl(var(--foreground))]">
            Onboarding Funnel
          </h3>
          <div className="space-y-3">
            {funnelData.map((step) => (
              <div key={step.label} className="flex items-center gap-4">
                <span className="w-28 shrink-0 text-sm text-[hsl(var(--foreground-muted))]">
                  {step.label}
                </span>
                <div className="flex-1">
                  <div className="h-8 rounded bg-[hsl(var(--primary)/0.15)]">
                    <div
                      className="flex h-8 items-center rounded bg-[hsl(var(--primary))] px-3"
                      style={{ width: `${(step.value / 5) * 100}%` }}
                    >
                      <span className="text-xs font-medium text-white">{step.value}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureUsageTab() {
  const maxViews = Math.max(...featureUsageData.map((d) => d.views));

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
          Page Views by Feature
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                Page
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                Views
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                Distribution
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {featureUsageData.map((item) => (
              <tr key={item.page}>
                <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-[hsl(var(--foreground))]">
                  {item.page}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground-muted))]">
                  {item.views}
                </td>
                <td className="px-6 py-4">
                  <div className="h-4 w-48 rounded bg-[hsl(var(--foreground-muted)/0.15)]">
                    <div
                      className="h-4 rounded bg-[hsl(var(--primary))]"
                      style={{ width: `${(item.views / maxViews) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AIAnalyticsTab() {
  return (
    <div className="space-y-8">
      {/* AI Metrics */}
      <section aria-label="AI performance metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Generations / Day" value="3.2" icon={Sparkles} />
          <MetricCard label="Success Rate" value="95%" icon={CheckCircle} />
          <MetricCard label="Avg Time" value="4.2s" icon={Clock} />
          <MetricCard label="Total Tokens" value="12,450" icon={Zap} />
        </div>
      </section>

      {/* AI Log Table */}
      <section aria-label="AI generation log">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
              Recent AI Generations
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                    Prompt Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                    Tokens
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {aiLogData.map((row, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground-muted))]">
                      {row.timestamp}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground))]">
                      {row.user}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground))]">
                      {row.promptType}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground-muted))]">
                      {row.tokens.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {row.status === "success" ? (
                        <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                          <CheckCircle className="h-4 w-4" /> Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                          <XCircle className="h-4 w-4" /> Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function ActivityLogTab() {
  const [filter, setFilter] = useState<ActivityType | "all">("all");

  const filtered = filter === "all"
    ? activityLogData
    : activityLogData.filter((entry) => entry.type === filter);

  function getDotColor(type: ActivityType) {
    switch (type) {
      case "user":
        return "bg-blue-500";
      case "system":
        return "bg-green-500";
      case "admin":
        return "bg-purple-500";
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        {(["all", "user", "system", "admin"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
              filter === type
                ? "bg-[hsl(var(--primary))] text-white"
                : "bg-[hsl(var(--foreground-muted)/0.1)] text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--foreground-muted)/0.2)]"
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card">
        <ul className="divide-y divide-border">
          {filtered.map((entry) => (
            <li key={entry.id} className="flex items-start gap-4 px-6 py-4">
              {/* Timeline dot */}
              <div className="relative mt-1.5 flex flex-col items-center">
                <span
                  className={cn("h-3 w-3 rounded-full", getDotColor(entry.type))}
                  aria-hidden="true"
                />
              </div>
              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[hsl(var(--foreground))]">{entry.message}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-[hsl(var(--foreground-muted))]">{entry.timestamp}</span>
                  <span className={cn(
                    "inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                    entry.type === "user" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                    entry.type === "system" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                    entry.type === "admin" && "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                  )}>
                    {entry.type}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function AdminAnalytics() {
  const [activeTab, setActiveTab] = useState<TabId>("users");

  return (
    <div className="space-y-6">
      {/* Tab navigation */}
      <nav aria-label="Analytics tabs" className="flex gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-[hsl(var(--primary))] text-white"
                : "text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--foreground-muted)/0.1)] hover:text-[hsl(var(--foreground))]"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {activeTab === "users" && <UserAnalyticsTab />}
      {activeTab === "features" && <FeatureUsageTab />}
      {activeTab === "ai" && <AIAnalyticsTab />}
      {activeTab === "activity" && <ActivityLogTab />}
    </div>
  );
}
