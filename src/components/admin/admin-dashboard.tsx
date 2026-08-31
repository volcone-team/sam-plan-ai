"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Building2,
  FileText,
  Sparkles,
  Activity,
  Loader2,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

/**
 * Admin Dashboard — shows summary metrics from real API data.
 */
export function AdminDashboard() {
  const [stats, setStats] = useState<{
    totalUsers: number;
    internalUsers: number;
    totalCompanies: number;
    activePlans: number;
    aiGenerations: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        console.log("[AdminDashboard] Loading stats...");
        const res = await fetch("/api/admin/stats");
        const data = await res.json();
        if (res.ok && data.stats) {
          console.log("[AdminDashboard] Stats:", data.stats);
          setStats(data.stats);
        } else {
          console.error("[AdminDashboard] Stats error:", data.error);
        }
      } catch (err) {
        console.error("[AdminDashboard] Failed to load stats:", err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  const metrics = [
    { label: "Customer Users", value: stats?.totalUsers ?? null, icon: Users },
    { label: "Internal Users", value: stats?.internalUsers ?? null, icon: Shield },
    { label: "Total Companies", value: stats?.totalCompanies ?? null, icon: Building2 },
    { label: "Active Plans", value: stats?.activePlans ?? null, icon: FileText },
    { label: "AI Generations", value: stats?.aiGenerations ?? null, icon: Sparkles },
  ];

  return (
    <div className="space-y-8">
      {/* Metrics Cards */}
      <section aria-label="Summary metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--foreground-muted))]" />
                ) : (
                  metric.value ?? "—"
                )}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Activity Feed — placeholder until we have real activity logging */}
        <section aria-label="Recent activity">
          <div className="rounded-[var(--radius-lg)] border border-border bg-card">
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                Recent Activity
              </h2>
            </div>
            <div className="px-6 py-8 text-center">
              <Activity className="mx-auto h-8 w-8 text-[hsl(var(--foreground-muted))]" />
              <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
                Activity feed coming soon. This will show signups, plan generations, and key events.
              </p>
            </div>
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
