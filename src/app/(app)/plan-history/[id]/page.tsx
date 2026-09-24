'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, DollarSign, Rocket, ListTodo, BarChart3, RotateCcw, Check, AlertTriangle, X, Trash2 } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { cacheInvalidatePrefix, CacheKeys } from '@/lib/client-cache';
import { useToast } from '@/components/ui/toast';
import { ProgressBar } from '@/components/ui/progress-bar';

interface SnapshotData {
  id: string;
  label: string;
  createdAt: string;
  data: {
    annualPlan: any;
    initiatives: any[];
    tasks: any[];
    projections: any[];
    results: any[];
    expenses: any[];
    snapshotDate: string;
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(amount);
}

export default function PlanSnapshotDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null); // "full" or an initiative id
  const [confirmFull, setConfirmFull] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { showToast } = useToast();

  const restore = async (initiativeId?: string) => {
    const key = initiativeId || "full";
    setRestoring(key);
    console.log("[PlanSnapshot] Restoring:", key);
    try {
      const url = initiativeId
        ? `/api/plan/history/${params.id}/restore?initiativeId=${initiativeId}`
        : `/api/plan/history/${params.id}/restore`;
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Restore failed", { variant: "error", duration: 5000 });
        return;
      }
      console.log("[PlanSnapshot] Restored:", json);
      // The plan changed - drop cached dashboard data so the user sees it.
      cacheInvalidatePrefix(CacheKeys.planPrefix);
      showToast(
        initiativeId
          ? "Initiative restored to your current plan."
          : `Plan restored — ${json.restored} initiative(s) added to your current plan. Your previous plan was saved to history.`,
        { variant: "success", duration: 5000 }
      );
      router.push("/year-at-a-glance");
    } catch (err: any) {
      showToast(err?.message || "Network error", { variant: "error", duration: 5000 });
    } finally {
      setRestoring(null);
      setConfirmFull(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    console.log("[PlanSnapshot] Deleting snapshot:", params.id);
    try {
      const res = await fetch(`/api/plan/history/${params.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error || "Could not delete this plan version.", { variant: "error", duration: 5000 });
        return;
      }
      showToast(`"${json.deletedLabel || "Plan version"}" deleted from history.`, { variant: "success", duration: 4000 });
      router.push("/plan-history");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Network error", { variant: "error", duration: 5000 });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  useEffect(() => {
    async function load() {
      try {
        console.log("[PlanSnapshot] Loading:", params.id);
        const res = await fetch(`/api/plan/history/${params.id}`);
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || 'Not found');
          console.error("[PlanSnapshot] Error:", json.error);
          return;
        }
        console.log("[PlanSnapshot] Loaded:", json.snapshot?.label, "| initiatives:", json.snapshot?.data?.initiatives?.length);
        setSnapshot(json.snapshot);
      } catch (err: any) {
        setError(err?.message || 'Failed to load');
        console.error("[PlanSnapshot] Fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        </div>
      </PageContainer>
    );
  }

  if (error || !snapshot) {
    return (
      <PageContainer>
        <button onClick={() => router.push('/plan-history')} className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to History
        </button>
        <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">{error || 'Snapshot not found'}</p>
        </div>
      </PageContainer>
    );
  }

  const { data } = snapshot;
  const plan = data.annualPlan;

  return (
    <PageContainer>
      {/* Back + Header */}
      <button onClick={() => router.push('/plan-history')} className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to History
      </button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{snapshot.label}</h1>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            Saved {new Date(snapshot.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmFull(true)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--background-muted))] transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore Entire Plan
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {/* Full-restore warning modal. Restoring replaces every not-started
          initiative and all revenue targets/projections in the current plan
          with this snapshot's data - make that unmistakably clear up front. */}
      {confirmFull && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-semibold">Restore this plan?</h3>
              </div>
              <button
                onClick={() => setConfirmFull(false)}
                className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Your current plan will be erased and replaced with &ldquo;{snapshot.label}&rdquo;.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                <li>• Upcoming initiatives you haven&apos;t started yet will be removed</li>
                <li>• Revenue targets and projections will be overwritten with this snapshot&apos;s numbers</li>
                <li>• Completed and in-progress initiatives are kept</li>
                <li>• Your current plan is saved to history first, so this can be undone</li>
              </ul>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                onClick={() => setConfirmFull(false)}
                disabled={restoring === "full"}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => restore()}
                disabled={restoring === "full"}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {restoring === "full" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Yes, Erase and Restore
              </button>
            </div>
            <ProgressBar
              active={restoring === "full"}
              estimatedMs={8000}
              label="Restoring your plan..."
              className="mt-4"
            />
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-semibold">Delete this plan version?</h3>
              </div>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                &ldquo;{snapshot.label}&rdquo; will be permanently removed from your history.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                <li>• Your current plan is not affected</li>
                <li>• You will no longer be able to restore this version</li>
                <li>• This cannot be undone</li>
              </ul>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revenue Summary */}
      {plan && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border border-border bg-card p-3">
            <p className="text-xs text-[hsl(var(--foreground-muted))]">Baseline Revenue</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(Number(plan.baseline_revenue) || 0)}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-card p-3">
            <p className="text-xs text-[hsl(var(--foreground-muted))]">Stretch Revenue</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(Number(plan.stretch_revenue) || 0)}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-card p-3">
            <p className="text-xs text-[hsl(var(--foreground-muted))]">Operating Budget</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(Number(plan.operating_budget) || 0)}</p>
          </div>
        </div>
      )}

      {/* Initiatives */}
      <div className="mb-6 rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Rocket className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold">Initiatives ({data.initiatives.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {data.initiatives.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[hsl(var(--foreground-muted))]">No initiatives in this snapshot</p>
          ) : (
            data.initiatives.map((init: any) => (
              <div key={init.id} className="relative flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{init.name}</p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    {init.kind} · {init.status}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-medium">{formatCurrency(Number(init.revenue_better) || 0)}</p>
                    <p className="text-xs text-[hsl(var(--foreground-muted))]">projected</p>
                  </div>
                  <button
                    onClick={() => restore(init.id)}
                    disabled={restoring === init.id}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-border px-2.5 py-1.5 text-xs font-medium hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--background-muted))] transition-colors disabled:opacity-50"
                    title="Restore just this initiative"
                  >
                    {restoring === init.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Restore
                  </button>
                </div>
                {restoring === init.id && (
                  <div className="absolute inset-x-5 bottom-0">
                    <ProgressBar active estimatedMs={5000} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tasks summary */}
      <div className="mb-6 rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <ListTodo className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold">Tasks ({data.tasks.length})</h3>
        </div>
        <div className="px-5 py-4">
          {data.tasks.length === 0 ? (
            <p className="text-sm text-[hsl(var(--foreground-muted))]">No tasks in this snapshot</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-center">
              <div>
                <p className="text-2xl font-bold">{data.tasks.length}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">Total</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.tasks.filter((t: any) => t.status === 'completed').length}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">Completed</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.tasks.filter((t: any) => t.status === 'in_progress').length}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">In Progress</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.tasks.filter((t: any) => t.status === 'not_started').length}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">Not Started</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Projections summary */}
      {data.projections.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3">
            <BarChart3 className="h-4 w-4 text-[hsl(var(--primary))]" />
            <h3 className="text-sm font-semibold">Projections ({data.projections.length} scenarios)</h3>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              {data.projections.map((proj: any) => {
                const monthly = (proj.monthly as any[]) || [];
                const total = monthly.reduce((sum, m) => sum + (Number(m.revenue) || 0), 0);
                return (
                  <div key={proj.id || proj.scenario}>
                    <p className="text-xs text-[hsl(var(--foreground-muted))] capitalize">{proj.scenario}</p>
                    <p className="mt-1 text-lg font-semibold">{formatCurrency(total)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
