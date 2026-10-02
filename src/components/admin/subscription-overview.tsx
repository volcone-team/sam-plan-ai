'use client';

import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Users, Gift } from 'lucide-react';
import { LoadingPanel } from '@/components/ui/spinner';

/**
 * Real revenue overview, replacing the prototype's hardcoded figures
 * ($347 MRR, 1 subscriber, a fake 6-month chart). Everything here comes from
 * /api/admin/billing/overview, which aggregates across all subscriptions.
 */

interface Overview {
  mrr: number;
  arr: number;
  payingSubscribers: number;
  trialing: number;
  comped: number;
  totalAccounts: number;
  collectedToDate: number;
  byPlan: { planId: string; name: string; monthlyPrice: number; subscribers: number; mrr: number }[];
}

function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function Metric({ label, value, sub, icon }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[hsl(var(--foreground-muted))]">{label}</p>
        <span className="text-[hsl(var(--foreground-subtle))]">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{sub}</p>}
    </div>
  );
}

export function SubscriptionOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/billing/overview', { credentials: 'same-origin' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || 'Could not load overview');
        }
        const body = (await res.json()) as Overview;
        if (active) setData(body);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingPanel />;

  if (error || !data) {
    return (
      <div role="alert" className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
        {error ?? 'No data.'}
      </div>
    );
  }

  // Largest MRR contributor drives the relative bar widths.
  const maxPlanMrr = Math.max(1, ...data.byPlan.map((p) => p.mrr));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Monthly recurring revenue" value={usd(data.mrr)} sub="Annual plans counted monthly" icon={<DollarSign className="h-4 w-4" />} />
        <Metric label="Annual recurring revenue" value={usd(data.arr)} sub="MRR × 12" icon={<TrendingUp className="h-4 w-4" />} />
        <Metric label="Paying subscribers" value={String(data.payingSubscribers)} sub={`${data.trialing} on trial`} icon={<Users className="h-4 w-4" />} />
        <Metric label="Comped" value={String(data.comped)} sub="Complimentary access" icon={<Gift className="h-4 w-4" />} />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="text-sm font-semibold">Subscribers by plan</h3>
        <div className="mt-4 space-y-3">
          {data.byPlan.map((p) => (
            <div key={p.planId}>
              <div className="flex items-center justify-between text-sm">
                <span>{p.name}</span>
                <span className="text-xs text-[hsl(var(--foreground-muted))]">
                  ${p.monthlyPrice}/mo · {p.subscribers} subscriber{p.subscribers === 1 ? '' : 's'} · {usd(p.mrr)} MRR
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]">
                <div
                  className="h-full rounded-full bg-[hsl(var(--primary))] transition-all"
                  style={{ width: `${Math.round((p.mrr / maxPlanMrr) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <p className="text-xs text-[hsl(var(--foreground-muted))]">Collected to date</p>
        <p className="mt-1 text-2xl font-bold">{usd(data.collectedToDate)}</p>
        <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
          Sum of paid invoices across all accounts
        </p>
      </div>
    </div>
  );
}
