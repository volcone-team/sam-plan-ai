"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

/** Subset of the GET /api/admin/activity entry shape this panel renders. */
interface ActivityEntry {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  createdAt: string;
}

/** How many entries the dashboard panel shows. The full log lives at /admin/activity. */
const ACTIVITY_LIMIT = 6;

/**
 * Colour the action pill by its subject — same convention as the full
 * activity log page so the two views read the same.
 */
function pillColor(action: string): string {
  if (action.startsWith("company.")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (action.endsWith(".deleted") || action.endsWith(".deactivated"))
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (action.endsWith(".created")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
}

/**
 * Compact timestamp for a dashboard row: relative for anything under a week,
 * otherwise a short date. Falls back to the raw value if unparseable.
 */
function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getStatusColor(status: SystemStatus): string {
  if (status === "warning") return "bg-yellow-400";
  return "bg-green-500";
}

/**
 * Build the system status list. Stripe is now DERIVED from real state rather
 * than hardcoded "Not connected": enabled and configured is green, configured
 * but switched off is a neutral note, and missing a key is the warning.
 */
function buildSystemStatus(stripe: {
  enabled: boolean; mode: string; configured: boolean;
} | null): StatusItem[] {
  let stripeStatus: SystemStatus = "warning";
  let stripeDescription = "Not connected";

  if (stripe) {
    // "Connected" depends ONLY on whether a key is present — NOT on whether
    // billing is enabled. Those are independent: a configured key is connected
    // regardless, and billing being on or off just says whether payment is
    // required at signup. Tying the two together is what made toggling the
    // setting appear to connect/disconnect Stripe.
    if (!stripe.configured) {
      stripeStatus = "warning";
      stripeDescription = "Not connected — set STRIPE_SECRET_KEY";
    } else {
      stripeStatus = "connected";
      // Billing on/off shown as a secondary note, not as the connection state.
      stripeDescription = stripe.enabled
        ? `Connected (${stripe.mode}) · billing on`
        : `Connected (${stripe.mode}) · billing off`;
    }
  }

  return [
    { label: "API", status: "healthy", description: "Healthy" },
    { label: "Database", status: "connected", description: "Connected" },
    { label: "AI Service", status: "ready", description: "Ready" },
    { label: "Stripe", status: stripeStatus, description: stripeDescription },
  ];
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
  const [stripe, setStripe] = useState<{
    enabled: boolean; mode: string; configured: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Activity feed state, kept deliberately separate from stats/loading above so
  // a failure in one panel never blanks the other.
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    // Abort on unmount: in dev a cold route compile can outlive the mount and
    // the aborted request otherwise surfaces as a bogus "Failed to fetch".
    const controller = new AbortController();

    const loadStats = async () => {
      try {
        // no-store so a toggle changed on the settings page is reflected here,
        // rather than a cached response showing the old Stripe status.
        const res = await fetch("/api/admin/stats", {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok && data.stats) {
          setStats(data.stats);
          if (data.stripe) setStripe(data.stripe);
        } else {
          console.error("[AdminDashboard] Stats error:", data.error);
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        console.error("[AdminDashboard] Failed to load stats:", err);
      }
      setLoading(false);
    };

    loadStats();

    // Refetch when the tab regains focus. Changing a setting on another page and
    // returning should show current state, not whatever was loaded on first
    // mount — the staleness that made Stripe status look like it was toggling.
    const onFocus = () => { loadStats(); };
    window.addEventListener("focus", onFocus);

    return () => {
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadActivity = async () => {
      try {
        const res = await fetch(`/api/admin/activity?limit=${ACTIVITY_LIMIT}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data: { entries?: ActivityEntry[] } = await res.json();
        setEntries(data.entries ?? []);
      } catch (err) {
        // Navigated away mid-request — not an error, and state is gone anyway.
        if ((err as Error)?.name === "AbortError") return;
        setActivityError("Could not load recent activity.");
      }
      setActivityLoading(false);
    };

    loadActivity();
    return () => controller.abort();
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
        {/* Activity Feed — latest entries from the admin audit trail */}
        <section aria-label="Recent activity">
          <div className="rounded-[var(--radius-lg)] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                Recent Activity
              </h2>
              <Link
                href="/admin/activity"
                className="text-sm font-medium text-[hsl(var(--primary))] transition-colors hover:underline"
              >
                View all
              </Link>
            </div>

            {activityLoading && (
              <div className="px-6 py-8">
                <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading activity…</p>
              </div>
            )}

            {/* Muted on purpose: one failed panel shouldn't make the dashboard
                look broken. */}
            {!activityLoading && activityError && (
              <div className="px-6 py-8">
                <p className="text-sm text-[hsl(var(--foreground-muted))]">{activityError}</p>
              </div>
            )}

            {!activityLoading && !activityError && entries.length === 0 && (
              <div className="px-6 py-8 text-center">
                <Activity className="mx-auto h-8 w-8 text-[hsl(var(--foreground-muted))]" />
                <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
                  No activity recorded yet
                </p>
                <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                  Admin actions like creating users or changing notification rules will appear here.
                </p>
              </div>
            )}

            {!activityLoading && !activityError && entries.length > 0 && (
              <ul className="divide-y divide-border">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-6 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-medium",
                          pillColor(entry.action)
                        )}
                      >
                        {entry.action}
                      </span>
                      <span className="whitespace-nowrap text-xs text-[hsl(var(--foreground-muted))]">
                        {formatRelative(entry.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-[hsl(var(--foreground-muted))]">
                      <span className="text-[hsl(var(--foreground))]">
                        {entry.actorEmail ?? "system"}
                      </span>
                      {entry.targetLabel && <> → {entry.targetLabel}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
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
              {buildSystemStatus(stripe).map((item) => (
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
