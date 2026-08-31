'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, DollarSign, Rocket, ListTodo, BarChart3 } from 'lucide-react';
import { PageContainer } from '@/components/layout';

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

      <div className="mb-6">
        <h1 className="text-xl font-bold">{snapshot.label}</h1>
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          Saved {new Date(snapshot.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
        <span className="mt-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Read-only snapshot
        </span>
      </div>

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
              <div key={init.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{init.name}</p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    {init.channel} · {init.kind} · {init.status}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{formatCurrency(Number(init.revenue_better) || 0)}</p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">projected</p>
                </div>
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
