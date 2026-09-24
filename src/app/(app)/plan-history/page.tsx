'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Eye, Loader2, FileText, Trash2, AlertTriangle, X } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout';
import { useToast } from '@/components/ui/toast';

interface Snapshot {
  id: string;
  label: string;
  createdAt: string;
}

export default function PlanHistoryPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  /** Snapshot awaiting delete confirmation. */
  const [confirmDelete, setConfirmDelete] = useState<Snapshot | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (snap: Snapshot) => {
    setDeletingId(snap.id);
    console.log("[PlanHistory] Deleting snapshot:", snap.id);
    try {
      const res = await fetch(`/api/plan/history/${snap.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error || 'Could not delete this plan version.', { variant: 'error', duration: 5000 });
        return;
      }
      // Drop it from the list without a full refetch.
      setSnapshots((prev) => prev.filter((x) => x.id !== snap.id));
      showToast(`"${snap.label}" deleted from history.`, { variant: 'success', duration: 4000 });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Network error', { variant: 'error', duration: 5000 });
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  useEffect(() => {
    async function load() {
      try {
        console.log("[PlanHistory] Loading snapshots...");
        const res = await fetch('/api/plan/history');
        if (res.ok) {
          const data = await res.json();
          console.log("[PlanHistory] Found", data.snapshots?.length, "snapshots");
          setSnapshots(data.snapshots || []);
        }
      } catch (err) {
        console.error("[PlanHistory] Load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Plan History"
        description="View previous versions of your revenue plan"
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        </div>
      ) : snapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <History className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold">No previous plans</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            When you regenerate your plan, the previous version will be saved here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center justify-between rounded-[var(--radius-lg)] border border-border bg-card px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)]">
                  <FileText className="h-4 w-4 text-[hsl(var(--primary))]" />
                </div>
                <div>
                  <p className="text-sm font-medium">{snap.label}</p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    Saved {new Date(snap.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push(`/plan-history/${snap.id}`)}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" />
                  View
                </button>
                <button
                  onClick={() => setConfirmDelete(snap)}
                  disabled={deletingId === snap.id}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                  title="Delete this plan version"
                >
                  {deletingId === snap.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation. Deleting history removes a recovery point, so
          make clear what is and is not affected. */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-semibold">Delete this plan version?</h3>
              </div>
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                &ldquo;{confirmDelete.label}&rdquo; will be permanently removed from your history.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                <li>• Your current plan is not affected</li>
                <li>• You will no longer be able to restore this version</li>
                <li>• This cannot be undone</li>
              </ul>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId === confirmDelete.id}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deletingId === confirmDelete.id}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingId === confirmDelete.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
