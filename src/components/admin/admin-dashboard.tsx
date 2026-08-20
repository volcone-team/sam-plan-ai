"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Building2,
  FileText,
  Sparkles,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Storage Keys (same as user-management and company-management)
   ------------------------------------------------------------------ */

const USERS_STORAGE_KEY = "sam-flow-admin-users-list";
const COMPANIES_STORAGE_KEY = "sam-flow-admin-companies-list";

/* ------------------------------------------------------------------
   Helpers to read counts from localStorage
   ------------------------------------------------------------------ */

function getUserCount(): number {
  if (typeof window === "undefined") return 5;
  try {
    const stored = localStorage.getItem(USERS_STORAGE_KEY);
    if (stored) return JSON.parse(stored).length;
  } catch {}
  return 5; // default mock count
}

function getCompanyCount(): number {
  if (typeof window === "undefined") return 2;
  try {
    const stored = localStorage.getItem(COMPANIES_STORAGE_KEY);
    if (stored) return JSON.parse(stored).length;
  } catch {}
  return 2; // default mock count
}

const activityFeed = [
  { message: "Plan generated for Elevate Coaching", time: "2 hours ago" },
  { message: "New user signed up: Sarah Mitchell", time: "1 day ago" },
  { message: "Initiative type 'Paid Ads' updated", time: "2 days ago" },
  { message: "Benchmark data refreshed", time: "3 days ago" },
  { message: "Webinar initiative launched", time: "5 days ago" },
];

type SystemStatus = "healthy" | "connected" | "ready" | "warning";

interface StatusItem {
  label: string;
  status: SystemStatus;
  description: string;
}

const systemStatus: StatusItem[] = [
  { label: "API", status: "healthy", description: "Healthy" },
  { label: "Database", status: "connected", description: "Connected" },
  { label: "AI Service", status: "ready", description: "Ready" },
  { label: "Stripe", status: "warning", description: "Not connected" },
];

function getStatusColor(status: SystemStatus): string {
  if (status === "warning") return "bg-yellow-400";
  return "bg-green-500";
}

/* ------------------------------------------------------------------
   Component
   ------------------------------------------------------------------ */

/**
 * Admin Dashboard — shows summary metrics, activity feed, and system status.
 * Uses mock data. No API calls.
 */
export function AdminDashboard() {
  const [userCount, setUserCount] = useState(5);
  const [companyCount, setCompanyCount] = useState(2);

  useEffect(() => {
    setUserCount(getUserCount());
    setCompanyCount(getCompanyCount());
  }, []);

  const metrics = [
    { label: "Total Users", value: userCount, icon: Users },
    { label: "Total Companies", value: companyCount, icon: Building2 },
    { label: "Active Plans", value: companyCount, icon: FileText },
    { label: "AI Generations", value: 24, icon: Sparkles },
  ];

  return (
    <div className="space-y-8">
      {/* Metrics Cards */}
      <section aria-label="Summary metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-[var(--radius-lg)] border border-border bg-card p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">
                  {metric.label}
                </p>
                <metric.icon className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
              </div>
              <p className="mt-2 text-3xl font-bold text-[hsl(var(--foreground))]">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Activity Feed */}
        <section aria-label="Recent activity">
          <div className="rounded-[var(--radius-lg)] border border-border bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                Recent Activity
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {activityFeed.map((item, i) => (
                <li key={i} className="flex items-start gap-3 px-6 py-4">
                  <Activity className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[hsl(var(--foreground))]">
                      {item.message}
                    </p>
                    <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
                      {item.time}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* System Status */}
        <section aria-label="System status">
          <div className="rounded-[var(--radius-lg)] border border-border bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                System Status
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {systemStatus.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {item.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        getStatusColor(item.status)
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "text-sm",
                        item.status === "warning"
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-green-600 dark:text-green-400"
                      )}
                    >
                      {item.description}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
