'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  Rocket,
  StickyNote,
  Loader2,
  AlertCircle,
  ChevronRight,
  Minus,
} from 'lucide-react';
import { planService } from '@/services/plan.service';
import { projectionService } from '@/services/projection.service';
import { initiativeService } from '@/services/initiative.service';
import { resultService } from '@/services/result.service';
import { MonthlySummaryTable } from './monthly-summary-table';
import type { MonthlyPlan, Initiative, Projection, Result } from '@/types';

const YEAR = 2026;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function getQuarterForMonth(month: number): number {
  return Math.ceil(month / 3);
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString()}`;
}

function getWeeksInMonth(year: number, month: number): { start: Date; end: Date }[] {
  const weeks: { start: Date; end: Date }[] = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  // Start from Monday of the week containing the 1st
  let current = new Date(firstDay);
  const dayOfWeek = current.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  current.setDate(current.getDate() + diff);

  while (current <= lastDay) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    weeks.push({ start: weekStart, end: weekEnd });
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

// formatDateShort imported from @/lib/format-date

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  launched: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-gray-100 text-gray-700',
  paused: 'bg-red-100 text-red-700',
  retired: 'bg-gray-100 text-gray-500',
};

interface WeekBreakdown {
  weekNumber: number;
  start: Date;
  end: Date;
  revenue: number;
  resultCount: number;
}

interface MonthProjections {
  good: number;
  better: number;
  best: number;
}

type TrendStatus = 'on_track' | 'behind' | 'ahead';

export function MonthlyPlanner() {
  const companyId = useCompanyId() || "";
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [monthlyPlan, setMonthlyPlan] = useState<MonthlyPlan | null>(null);
  const [projections, setProjections] = useState<MonthProjections>({ good: 0, better: 0, best: 0 });
  const [actualRevenue, setActualRevenue] = useState(0);
  const [weekBreakdown, setWeekBreakdown] = useState<WeekBreakdown[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [trendStatus, setTrendStatus] = useState<TrendStatus>('on_track');

  useEffect(() => {
    if (!companyId) return;
    const loadMonthData = async () => {
      try {
        setLoading(true);
        setError(null);

        const quarter = getQuarterForMonth(selectedMonth);
        const monthStart = new Date(YEAR, selectedMonth - 1, 1);
        const monthEnd = new Date(YEAR, selectedMonth, 0, 23, 59, 59, 999);

        // Fetch all data in parallel
        const [monthlyPlans, allProjections, results, monthInitiatives] = await Promise.all([
          planService.getMonthlyPlans(companyId, YEAR, quarter),
          projectionService.getProjectionsByCompany(companyId),
          resultService.getResultsByMonth(companyId, YEAR, selectedMonth),
          initiativeService.getInitiativesByDateRange(companyId, monthStart, monthEnd),
        ]);

        // Find the plan for this month
        const plan = monthlyPlans.find(p => p.month === selectedMonth) || null;
        setMonthlyPlan(plan);

        // Calculate month projections from projection data
        const goodProj = allProjections.find(p => p.scenario === 'good');
        const betterProj = allProjections.find(p => p.scenario === 'better');
        const bestProj = allProjections.find(p => p.scenario === 'best');

        const getMonthRevenue = (proj: Projection | undefined): number => {
          if (!proj?.monthly) return 0;
          const monthEntry = (proj.monthly as any[]).find((m: any) => m.month === selectedMonth);
          return monthEntry?.revenue || 0;
        };

        const monthGood = getMonthRevenue(goodProj);
        const monthBetter = getMonthRevenue(betterProj);
        const monthBest = getMonthRevenue(bestProj);
        setProjections({ good: monthGood, better: monthBetter, best: monthBest });

        // Calculate actual revenue for the month
        const totalActual = results.reduce((sum: number, r: Result) => sum + r.actualRevenue, 0);
        setActualRevenue(totalActual);

        // Determine trend status (actual vs better/moderate scenario)
        const moderateTarget = monthBetter;
        if (moderateTarget > 0) {
          const ratio = totalActual / moderateTarget;
          if (ratio >= 0.95) {
            setTrendStatus('ahead');
          } else if (ratio >= 0.5) {
            setTrendStatus('on_track');
          } else {
            setTrendStatus('behind');
          }
        } else {
          setTrendStatus('on_track');
        }

        // Build week-by-week breakdown
        const weeks = getWeeksInMonth(YEAR, selectedMonth);
        const weekData: WeekBreakdown[] = weeks.map((week, idx) => {
          // Find results that fall within this week
          const weekResults = results.filter((r: Result) => {
            const rStart = r.weekStartDate instanceof Date ? r.weekStartDate : new Date(r.weekStartDate);
            return rStart >= week.start && rStart <= week.end;
          });
          const weekRevenue = weekResults.reduce((sum: number, r: Result) => sum + r.actualRevenue, 0);

          return {
            weekNumber: idx + 1,
            start: week.start,
            end: week.end,
            revenue: weekRevenue,
            resultCount: weekResults.length,
          };
        });
        setWeekBreakdown(weekData);

        // Set initiatives
        setInitiatives(monthInitiatives);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load monthly data';
        setError(message);
        console.error('Error loading monthly planner data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadMonthData();
  }, [selectedMonth, companyId]);

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

  const targetRevenue = monthlyPlan?.targetRevenue || 0;
  const moderateProjection = projections.better;
  const progressPct = moderateProjection > 0 ? Math.min((actualRevenue / moderateProjection) * 100, 100) : 0;

  return (
    <div className="space-y-6">
      {/* Monthly Summary Table */}
      <MonthlySummaryTable />

      {/* Month Selector */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {MONTH_SHORT.map((name, idx) => {
          const month = idx + 1;
          return (
            <button
              key={month}
              onClick={() => setSelectedMonth(month)}
              className={`px-3 py-2 rounded-[var(--radius-lg)] text-sm font-medium transition-colors whitespace-nowrap ${
                selectedMonth === month
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--muted))]/80'
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Monthly Revenue Summary */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">
            {MONTH_NAMES[selectedMonth - 1]} {YEAR} Revenue Summary
          </h3>
          <TrendBadge status={trendStatus} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <SummaryCard label="Target" value={formatCurrency(targetRevenue)} variant="default" />
          <SummaryCard label="Good" value={formatCurrency(projections.good)} variant="amber" />
          <SummaryCard label="Better" value={formatCurrency(projections.better)} variant="blue" />
          <SummaryCard label="Best" value={formatCurrency(projections.best)} variant="emerald" />
          <SummaryCard label="Actual" value={formatCurrency(actualRevenue)} variant="default" />
        </div>

        {/* Progress bar: actual vs moderate projection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[hsl(var(--foreground-muted))]">
              Progress: Actual vs Projected (Better)
            </span>
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
            <span>{formatCurrency(moderateProjection)}</span>
          </div>
        </div>
      </div>

      {/* Week-by-Week Breakdown */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Week-by-Week Breakdown</h3>
        </div>

        {weekBreakdown.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No week data available for this month.
          </p>
        ) : (
          <div className="space-y-3">
            {weekBreakdown.map(week => (
              <div
                key={week.weekNumber}
                className="rounded-[var(--radius-lg)] border border-border p-4 flex items-center gap-4"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center">
                  <span className="text-sm font-bold text-[hsl(var(--foreground-muted))]">
                    W{week.weekNumber}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {formatDateShort(week.start)} – {formatDateShort(week.end)}
                  </p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    {week.resultCount > 0
                      ? `${week.resultCount} result${week.resultCount !== 1 ? 's' : ''} recorded`
                      : 'No results yet'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">
                    {week.revenue > 0 ? formatCurrency(week.revenue) : '—'}
                  </p>
                  {week.revenue > 0 && (
                    <p className="text-xs text-[hsl(var(--foreground-muted))]">revenue</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Initiatives Active This Month */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">
            Initiatives Active in {MONTH_NAMES[selectedMonth - 1]}
          </h3>
          <span className="ml-auto text-sm text-[hsl(var(--foreground-muted))]">
            {initiatives.length} initiative{initiatives.length !== 1 ? 's' : ''}
          </span>
        </div>

        {initiatives.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No initiatives scheduled for this month.
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

      {/* Monthly Notes */}
      {monthlyPlan?.notes && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-3">
          <div className="flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">Monthly Notes</h3>
          </div>
          <p className="text-sm text-[hsl(var(--foreground-muted))] leading-relaxed">
            {monthlyPlan.notes}
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

interface TrendBadgeProps {
  status: TrendStatus;
}

function TrendBadge({ status }: TrendBadgeProps) {
  const config = {
    on_track: {
      label: 'On Track',
      icon: Minus,
      classes: 'bg-blue-100 text-blue-700',
    },
    behind: {
      label: 'Behind',
      icon: TrendingDown,
      classes: 'bg-red-100 text-red-700',
    },
    ahead: {
      label: 'Ahead',
      icon: TrendingUp,
      classes: 'bg-emerald-100 text-emerald-700',
    },
  };

  const { label, icon: Icon, classes } = config[status];

  return (
    <span className={`ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${classes}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
