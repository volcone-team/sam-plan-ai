'use client';

import { COMPANY_ID } from '@/lib/constants';
const companyId = COMPANY_ID;

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target,
  TrendingUp,
  CalendarDays,
  Rocket,
  StickyNote,
  Loader2,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { planService } from '@/services/plan.service';
import { projectionService } from '@/services/projection.service';
import { initiativeService } from '@/services/initiative.service';
import { resultService } from '@/services/result.service';
import { QuarterlySummaryTable } from './quarterly-summary-table';
import type { QuarterlyPlan, Initiative, Projection } from '@/types';

const YEAR = 2026;

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getCurrentQuarter(): number {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function getQuarterDateRange(quarter: number, year: number): { start: Date; end: Date } {
  const startMonth = (quarter - 1) * 3; // 0-indexed
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { start, end };
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

interface MonthlyBreakdown {
  month: number;
  name: string;
  target: number;
  good: number;
  better: number;
  best: number;
}

interface QuarterProjections {
  good: number;
  better: number;
  best: number;
}

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  launched: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-gray-100 text-gray-700',
  paused: 'bg-red-100 text-red-700',
  retired: 'bg-gray-100 text-gray-500',
};

export function QuarterlyPlanner() {
  const router = useRouter();
  const [selectedQuarter, setSelectedQuarter] = useState(getCurrentQuarter());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [quarterPlan, setQuarterPlan] = useState<QuarterlyPlan | null>(null);
  const [quarterProjections, setQuarterProjections] = useState<QuarterProjections>({ good: 0, better: 0, best: 0 });
  const [actualRevenue, setActualRevenue] = useState(0);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<MonthlyBreakdown[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);

  useEffect(() => {
    const loadQuarterData = async () => {
      try {
        setLoading(true);
        setError(null);

        const { start, end } = getQuarterDateRange(selectedQuarter, YEAR);
        const months = QUARTER_MONTHS[selectedQuarter];

        // Fetch all data in parallel
        const [quarterlyPlans, projections, results, quarterInitiatives] = await Promise.all([
          planService.getQuarterlyPlans(companyId, YEAR),
          projectionService.getProjectionsByCompany(companyId),
          resultService.getResultsByDateRange(start, end),
          initiativeService.getInitiativesByDateRange(companyId, start, end),
        ]);

        // Find the plan for this quarter
        const plan = quarterlyPlans.find(p => p.quarter === selectedQuarter) || null;
        setQuarterPlan(plan);

        // Calculate quarter projections from monthly data
        const goodProj = projections.find(p => p.scenario === 'good');
        const betterProj = projections.find(p => p.scenario === 'better');
        const bestProj = projections.find(p => p.scenario === 'best');

        const sumMonths = (proj: Projection | undefined, monthList: number[]) => {
          if (!proj?.monthly) return 0;
          return (proj.monthly as any[])
            .filter((m: any) => monthList.includes(m.month))
            .reduce((sum: number, m: any) => sum + m.revenue, 0);
        };

        const qGood = sumMonths(goodProj, months);
        const qBetter = sumMonths(betterProj, months);
        const qBest = sumMonths(bestProj, months);
        setQuarterProjections({ good: qGood, better: qBetter, best: qBest });

        // Calculate actual revenue to date
        const totalActual = results.reduce((sum, r) => sum + r.actualRevenue, 0);
        setActualRevenue(totalActual);

        // Build monthly breakdown
        const monthlyData: MonthlyBreakdown[] = months.map(m => ({
          month: m,
          name: MONTH_NAMES[m],
          target: 0, // from plan monthly targets if available
          good: (goodProj?.monthly as any[])?.find((x: any) => x.month === m)?.revenue || 0,
          better: (betterProj?.monthly as any[])?.find((x: any) => x.month === m)?.revenue || 0,
          best: (bestProj?.monthly as any[])?.find((x: any) => x.month === m)?.revenue || 0,
        }));
        setMonthlyBreakdown(monthlyData);

        // Set initiatives
        setInitiatives(quarterInitiatives);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load quarterly data';
        setError(message);
        console.error('Error loading quarterly planner data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadQuarterData();
  }, [selectedQuarter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-destructive/50 bg-destructive/5 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const targetRevenue = quarterPlan?.targetRevenue || 0;
  const progressPct = targetRevenue > 0 ? Math.min((actualRevenue / targetRevenue) * 100, 100) : 0;

  return (
    <div className="space-y-6">
      {/* Quarterly Summary Table */}
      <QuarterlySummaryTable />

      {/* Quarter Selector */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map(q => (
          <button
            key={q}
            onClick={() => setSelectedQuarter(q)}
            className={`px-4 py-2 rounded-[var(--radius-lg)] text-sm font-medium transition-colors ${
              selectedQuarter === q
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--muted))]/80'
            }`}
          >
            Q{q} {YEAR}
          </button>
        ))}
      </div>

      {/* Quarter Revenue Summary */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Q{selectedQuarter} Revenue Summary</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <SummaryCard label="Target" value={formatCurrency(targetRevenue)} variant="default" />
          <SummaryCard label="Good" value={formatCurrency(quarterProjections.good)} variant="amber" />
          <SummaryCard label="Better" value={formatCurrency(quarterProjections.better)} variant="blue" />
          <SummaryCard label="Best" value={formatCurrency(quarterProjections.best)} variant="emerald" />
          <SummaryCard label="Actual to Date" value={formatCurrency(actualRevenue)} variant="default" />
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[hsl(var(--foreground-muted))]">Progress: Actual vs Target</span>
            <span className="font-medium">{progressPct.toFixed(1)}%</span>
          </div>
          <div className="h-3 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-[hsl(var(--foreground-muted))]">
            <span>{formatCurrency(actualRevenue)}</span>
            <span>{formatCurrency(targetRevenue)}</span>
          </div>
        </div>
      </div>

      {/* Monthly Breakdown */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Monthly Breakdown</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {monthlyBreakdown.map(month => (
            <div
              key={month.month}
              className="rounded-[var(--radius-lg)] border border-border p-4 space-y-3"
            >
              <h4 className="text-sm font-semibold">{month.name}</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-amber-600 font-medium">Good</span>
                  <span className="font-semibold">{formatCurrency(month.good)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-blue-600 font-medium">Better</span>
                  <span className="font-semibold">{formatCurrency(month.better)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-600 font-medium">Best</span>
                  <span className="font-semibold">{formatCurrency(month.best)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Initiatives Active in Quarter */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Initiatives Active in Q{selectedQuarter}</h3>
          <span className="ml-auto text-sm text-[hsl(var(--foreground-muted))]">
            {initiatives.length} initiative{initiatives.length !== 1 ? 's' : ''}
          </span>
        </div>

        {initiatives.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No initiatives scheduled for this quarter.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {initiatives.map(initiative => (
              <button
                key={initiative.id}
                onClick={() => router.push(`/initiatives/${initiative.id}`)}
                className="w-full flex items-center gap-3 py-3 px-2 text-left hover:bg-[hsl(var(--muted))]/50 rounded-[var(--radius-lg)] transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))]">
                    {initiative.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-[hsl(var(--foreground-muted))] capitalize">
                      {initiative.kind.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">•</span>
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">
                      {formatCurrency(initiative.revenueScenarios.good)} – {formatCurrency(initiative.revenueScenarios.best)}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                    STATUS_COLORS[initiative.status] || 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {initiative.status.replace('_', ' ')}
                </span>
                <ChevronRight className="h-4 w-4 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))] shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Strategic Notes */}
      {quarterPlan?.notes && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-3">
          <div className="flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">Strategic Notes</h3>
          </div>
          <p className="text-sm text-[hsl(var(--foreground-muted))] leading-relaxed">
            {quarterPlan.notes}
          </p>
        </div>
      )}
    </div>
  );
}

/* --- Sub-components --- */

interface SummaryCardProps {
  label: string;
  value: string;
  variant: 'default' | 'amber' | 'blue' | 'emerald';
}

function SummaryCard({ label, value, variant }: SummaryCardProps) {
  const accentClasses = {
    default: 'text-[hsl(var(--foreground-muted))]',
    amber: 'text-amber-500',
    blue: 'text-blue-500',
    emerald: 'text-emerald-500',
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
      <span className={`text-xs font-medium ${accentClasses[variant]}`}>{label}</span>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
