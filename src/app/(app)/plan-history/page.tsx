'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Eye, Loader2, FileText } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout';

interface Snapshot {
  id: string;
  label: string;
  createdAt: string;
}

export default function PlanHistoryPage() {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

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
              <button
                onClick={() => router.push(`/plan-history/${snap.id}`)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
