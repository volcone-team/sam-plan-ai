"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Types — mirror the GET /api/admin/activity contract
   ------------------------------------------------------------------ */

interface ActivityEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  companyId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
}

/* ------------------------------------------------------------------
   Constants — the instrumented action set (see src/lib/activity-log.ts
   callers). "" means "all actions".
   ------------------------------------------------------------------ */

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "user.created", label: "User created" },
  { value: "user.deleted", label: "User deleted" },
  { value: "user.deactivated", label: "User deactivated" },
  { value: "user.role_changed", label: "User role changed" },
  { value: "user.admin_level_changed", label: "User admin level changed" },
  { value: "company.created", label: "Company created" },
  { value: "company.deleted", label: "Company deleted" },
  { value: "notification_rules.updated", label: "Notification rules updated" },
];

const PAGE_SIZE = 50;

/** Colour the action pill by its subject (the part before the first dot). */
function pillColor(action: string): string {
  if (action.startsWith("company.")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (action.endsWith(".deleted") || action.endsWith(".deactivated"))
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (action.endsWith(".created")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
}

/** Readable timestamp; falls back to the raw value if unparseable. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hasMetadata(metadata: Record<string, unknown>): boolean {
  return metadata != null && Object.keys(metadata).length > 0;
}

/* ------------------------------------------------------------------
   Main component
   ------------------------------------------------------------------ */

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // NOTE: deliberately does NOT call setLoading(true) here. When invoked from
  // the effect below, a synchronous setState during an effect trips this repo's
  // react-hooks/set-state-in-effect rule. Callers that are EVENTS (filter
  // change, pagination) set the loading flag themselves; the initial load uses
  // the `loading` initial value of true.
  const load = useCallback(async (nextOffset: number, action: string) => {
    try {
      setError(null);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      if (action) params.set("action", action);

      const res = await fetch(`/api/admin/activity?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data: ActivityResponse = await res.json();
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Could not load the activity log. Please try again.");
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      await load(offset, actionFilter);
      if (!mounted) return;
    };
    run();
    return () => {
      mounted = false;
    };
  }, [load, offset, actionFilter]);

  const handleFilterChange = (value: string) => {
    setLoading(true);
    setActionFilter(value);
    setOffset(0);
    setExpanded({});
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = offset + entries.length;
  const hasPrev = offset > 0;
  const hasNext = pageEnd < total;

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <label
            htmlFor="activity-action-filter"
            className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
          >
            Filter by action
          </label>
          <select
            id="activity-action-filter"
            value={actionFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {!loading && !error && total > 0 && (
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Showing {pageStart}–{pageEnd} of {total}
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading activity…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && entries.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-10 text-center">
          <ScrollText className="mx-auto h-8 w-8 text-[hsl(var(--foreground-muted))]" />
          <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
            No activity recorded yet
          </p>
        </div>
      )}

      {/* Entries */}
      {!loading && !error && entries.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Admin activity log, newest first. Each row shows when an action happened, who
              performed it, what the action was, and which record it affected.
            </caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                <th scope="col" className="px-4 py-3 font-medium">When</th>
                <th scope="col" className="px-4 py-3 font-medium">Actor</th>
                <th scope="col" className="px-4 py-3 font-medium">Action</th>
                <th scope="col" className="px-4 py-3 font-medium">Target</th>
                <th scope="col" className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const isOpen = Boolean(expanded[entry.id]);
                const showDetails = hasMetadata(entry.metadata);
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-[hsl(var(--foreground-muted))]">
                      {formatTimestamp(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground))]">
                      {entry.actorEmail ?? (
                        <span className="text-[hsl(var(--foreground-muted))]">system</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-medium",
                          pillColor(entry.action)
                        )}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[hsl(var(--foreground))]">
                        {entry.targetLabel ?? "—"}
                      </span>
                      {entry.targetType && (
                        <span className="ml-1 text-xs text-[hsl(var(--foreground-muted))]">
                          ({entry.targetType})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {showDetails ? (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(entry.id)}
                            aria-expanded={isOpen}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] transition-colors hover:underline"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            {isOpen ? "Hide" : "Show"} details
                          </button>
                          {isOpen && (
                            <pre className="mt-2 max-w-md overflow-x-auto rounded-[var(--radius-md)] bg-[hsl(var(--muted))] p-2 font-mono text-xs text-[hsl(var(--foreground))]">
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-[hsl(var(--foreground-muted))]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && (hasPrev || hasNext) && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { setLoading(true); setOffset(Math.max(offset - PAGE_SIZE, 0)); }}
            disabled={!hasPrev}
            className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={() => { setLoading(true); setOffset(offset + PAGE_SIZE); }}
            disabled={!hasNext}
            className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load more →
          </button>
        </div>
      )}
    </div>
  );
}
