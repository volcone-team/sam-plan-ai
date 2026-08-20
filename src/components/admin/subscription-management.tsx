"use client";

import { useState } from "react";
import {
  DollarSign,
  Users,
  TrendingUp,
  CreditCard,
  AlertCircle,
  Tag,
  BarChart3,
  ChevronDown,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Mock Data
   ------------------------------------------------------------------ */

const revenueMetrics = {
  mrr: 347,
  arr: 4164,
  totalSubscribers: 1,
  churnRate: 0,
};

const tiers = [
  { name: "Starter", price: 49, subscribers: 0, color: "bg-blue-500" },
  { name: "Pro", price: 149, subscribers: 1, color: "bg-purple-500" },
  { name: "Mastery", price: 299, subscribers: 0, color: "bg-amber-500" },
];

const subscribers = [
  {
    id: 1,
    company: "Elevate Coaching",
    owner: "Sarah Mitchell",
    tier: "Pro",
    status: "Active" as const,
    started: "Jan 2026",
    nextBilling: "Feb 2026",
  },
];

const revenueChart = [
  { month: "Aug", revenue: 0 },
  { month: "Sep", revenue: 0 },
  { month: "Oct", revenue: 0 },
  { month: "Nov", revenue: 149 },
  { month: "Dec", revenue: 149 },
  { month: "Jan", revenue: 149 },
];

/* ------------------------------------------------------------------
   Sub-components
   ------------------------------------------------------------------ */

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
}) {
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

function RevenueOverview() {
  return (
    <section aria-label="Revenue overview">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Monthly Recurring Revenue" value={`$${revenueMetrics.mrr}`} icon={DollarSign} />
        <MetricCard label="Annual Recurring Revenue" value={`$${revenueMetrics.arr.toLocaleString()}`} icon={TrendingUp} />
        <MetricCard label="Total Subscribers" value={String(revenueMetrics.totalSubscribers)} icon={Users} />
        <MetricCard label="Churn Rate" value={`${revenueMetrics.churnRate}%`} icon={BarChart3} />
      </div>
    </section>
  );
}

function SubscribersByTier() {
  const totalPossible = 3;

  return (
    <section aria-label="Subscribers by tier">
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold text-[hsl(var(--foreground))]">
          Subscribers by Tier
        </h3>
        <div className="space-y-4">
          {tiers.map((tier) => (
            <div key={tier.name} className="flex items-center gap-4">
              <span className="w-20 shrink-0 text-sm font-medium text-[hsl(var(--foreground))]">
                {tier.name}
              </span>
              <div className="flex-1">
                <div className="h-8 rounded bg-[hsl(var(--foreground-muted)/0.1)]">
                  {tier.subscribers > 0 && (
                    <div
                      className={cn("flex h-8 items-center rounded px-3", tier.color)}
                      style={{ width: `${(tier.subscribers / totalPossible) * 100}%` }}
                    >
                      <span className="text-xs font-medium text-white">
                        {tier.subscribers}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <span className="w-32 shrink-0 text-right text-sm text-[hsl(var(--foreground-muted))]">
                ${tier.price}/mo · {tier.subscribers} subscriber{tier.subscribers !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SubscriptionTable() {
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);

  function handleChangeTier(subscriberId: number, newTier: string) {
    alert(`Stripe not connected — cannot change to ${newTier} tier`);
    setOpenDropdown(null);
  }

  function handleCancel() {
    alert("Stripe not connected");
  }

  return (
    <section aria-label="Subscription list">
      <div className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
            Active Subscriptions
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Company
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Owner
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Tier
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Started
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Next Billing
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscribers.map((sub) => (
                <tr key={sub.id}>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-[hsl(var(--foreground))]">
                    {sub.company}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground-muted))]">
                    {sub.owner}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                      {sub.tier}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      {sub.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground-muted))]">
                    {sub.started}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-[hsl(var(--foreground-muted))]">
                    {sub.nextBilling}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center gap-2">
                      {/* Change Tier Dropdown */}
                      <div className="relative">
                        <button
                          onClick={() =>
                            setOpenDropdown(openDropdown === sub.id ? null : sub.id)
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--foreground-muted)/0.1)]"
                        >
                          Change Tier
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {openDropdown === sub.id && (
                          <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-border bg-card py-1 shadow-lg">
                            {tiers
                              .filter((t) => t.name !== sub.tier)
                              .map((t) => (
                                <button
                                  key={t.name}
                                  onClick={() => handleChangeTier(sub.id, t.name)}
                                  className="block w-full px-4 py-2 text-left text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground-muted)/0.1)]"
                                >
                                  {t.name} (${t.price}/mo)
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                      {/* Cancel Button */}
                      <button
                        onClick={handleCancel}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <XCircle className="h-3 w-3" />
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function RevenueChart() {
  const maxRevenue = Math.max(...revenueChart.map((d) => d.revenue), 1);

  return (
    <section aria-label="Revenue trend">
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold text-[hsl(var(--foreground))]">
          Revenue Trend (6 Months)
        </h3>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {revenueChart.map((item) => (
            <div key={item.month} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                {item.revenue > 0 ? `$${item.revenue}` : "$0"}
              </span>
              <div
                className={cn(
                  "w-full rounded-t transition-all",
                  item.revenue > 0
                    ? "bg-[hsl(var(--primary))]"
                    : "bg-[hsl(var(--foreground-muted)/0.15)]"
                )}
                style={{
                  height: item.revenue > 0 ? `${(item.revenue / maxRevenue) * 100}%` : "8px",
                  minHeight: "8px",
                }}
              />
              <span className="text-xs text-[hsl(var(--foreground-muted))]">{item.month}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StripeIntegration() {
  function handleConnectStripe() {
    alert("Stripe integration coming in Phase 13");
  }

  return (
    <section aria-label="Stripe integration">
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--foreground-muted)/0.1)]">
              <CreditCard className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
                Stripe Integration
              </h3>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-sm text-[hsl(var(--foreground-muted))]">Not Connected</span>
              </div>
            </div>
          </div>
          <button
            onClick={handleConnectStripe}
            className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[hsl(var(--primary)/0.9)]"
          >
            <Zap className="h-4 w-4" />
            Connect Stripe
          </button>
        </div>

        {/* Webhook Log */}
        <div className="mt-6 rounded-md border border-border p-4">
          <h4 className="text-sm font-medium text-[hsl(var(--foreground))]">Webhook Log</h4>
          <div className="mt-2 flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))]">
            <AlertCircle className="h-4 w-4" />
            No webhooks received yet
          </div>
        </div>
      </div>
    </section>
  );
}

function PromoCodes() {
  return (
    <section aria-label="Promo codes">
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tag className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">Promo Codes</h3>
          </div>
          <span className="rounded-full bg-[hsl(var(--foreground-muted)/0.1)] px-3 py-1 text-xs font-medium text-[hsl(var(--foreground-muted))]">
            Coming Soon
          </span>
        </div>
        <div className="mt-6 flex flex-col items-center justify-center rounded-md border border-dashed border-border py-8">
          <Tag className="h-8 w-8 text-[hsl(var(--foreground-muted)/0.4)]" />
          <p className="mt-3 text-sm font-medium text-[hsl(var(--foreground-muted))]">
            Create your first promo code
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted)/0.7)]">
            Promo code management will be available in a future update.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function SubscriptionManagement() {
  return (
    <div className="space-y-6">
      <RevenueOverview />
      <SubscribersByTier />
      <SubscriptionTable />
      <RevenueChart />
      <StripeIntegration />
      <PromoCodes />
    </div>
  );
}
