'use client';

import { TrendingUp } from 'lucide-react';

interface MonthlyData {
  month: number;
  good: number;
  better: number;
  best: number;
}

interface RevenueChartProps {
  data: MonthlyData[];
  maxRevenue?: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export function RevenueChart({ data, maxRevenue }: RevenueChartProps) {
  const max = maxRevenue || Math.max(...data.flatMap(d => [d.good, d.better, d.best]));

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
        <h3 className="text-lg font-semibold">Monthly Revenue Projections</h3>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-6 text-sm">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-amber-500" />
          <span className="text-[hsl(var(--foreground-muted))]">Good</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-blue-500" />
          <span className="text-[hsl(var(--foreground-muted))]">Better</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm bg-emerald-500" />
          <span className="text-[hsl(var(--foreground-muted))]">Best</span>
        </div>
      </div>

      {/* Chart */}
      <div className="space-y-3">
        {data.map((item) => {
          const goodWidth = max > 0 ? (item.good / max) * 100 : 0;
          const betterWidth = max > 0 ? (item.better / max) * 100 : 0;
          const bestWidth = max > 0 ? (item.best / max) * 100 : 0;

          return (
            <div key={item.month} className="group">
              <div className="flex items-center gap-3">
                <span className="w-8 text-xs font-medium text-[hsl(var(--foreground-muted))] shrink-0">
                  {MONTH_LABELS[item.month - 1]}
                </span>
                <div className="flex-1 space-y-1">
                  {/* Good bar */}
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-amber-500/80 transition-all group-hover:bg-amber-500"
                      style={{ width: `${Math.max(goodWidth, 1)}%` }}
                    />
                    <span className="text-[10px] text-[hsl(var(--foreground-muted))] opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatCurrency(item.good)}
                    </span>
                  </div>
                  {/* Better bar */}
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-blue-500/80 transition-all group-hover:bg-blue-500"
                      style={{ width: `${Math.max(betterWidth, 1)}%` }}
                    />
                    <span className="text-[10px] text-[hsl(var(--foreground-muted))] opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatCurrency(item.better)}
                    </span>
                  </div>
                  {/* Best bar */}
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-emerald-500/80 transition-all group-hover:bg-emerald-500"
                      style={{ width: `${Math.max(bestWidth, 1)}%` }}
                    />
                    <span className="text-[10px] text-[hsl(var(--foreground-muted))] opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatCurrency(item.best)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
