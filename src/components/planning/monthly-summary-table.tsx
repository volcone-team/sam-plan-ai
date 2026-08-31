'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { projectionService } from '@/services/projection.service';
import { resultService } from '@/services/result.service';
import { initiativeService } from '@/services/initiative.service';
import { exportToCSV } from '@/lib/csv-export';
import type { Initiative, Projection } from '@/types';

const YEAR = new Date().getFullYear();

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

function getMonthDateRange(month: number, year: number): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

interface MonthData {
  month: number;
  good: number;
  better: number;
  best: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  initiatives: Initiative[];
}

const STATUS_COLORS: Record<string, { dot: string; badge: string }> = {
  planned: { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' },
  in_progress: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
  launched: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  completed: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  paused: { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700' },
  retired: { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-500' },
};

export function MonthlySummaryTable() {
  const companyId = useCompanyId() || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthsData, setMonthsData] = useState<MonthData[]>([]);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  const currentMonth = getCurrentMonth();

  useEffect(() => {
    if (!companyId) return;
    const loadAllMonths = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch projections once
        const projections = await projectionService.getProjectionsByCompany(companyId);
        const goodProj = projections.find(p => p.scenario === 'good');
        const betterProj = projections.find(p => p.scenario === 'better');
        const bestProj = projections.find(p => p.scenario === 'best');

        const getMonthRevenue = (proj: Projection | undefined, month: number): number => {
          if (!proj?.monthly) return 0;
          const monthEntry = (proj.monthly as any[]).find((m: any) => m.month === month);
          return monthEntry?.revenue || 0;
        };

        // Load data for all 12 months
        const monthPromises = Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
          const { start, end } = getMonthDateRange(m, YEAR);

          const [results, initiatives] = await Promise.all([
            resultService.getResultsByDateRange(start, end),
            initiativeService.getInitiativesByDateRange(companyId, start, end),
          ]);

          const good = getMonthRevenue(goodProj, m);
          const better = getMonthRevenue(betterProj, m);
          const best = getMonthRevenue(bestProj, m);
          const actual = results.reduce((sum, r) => sum + r.actualRevenue, 0);
          const variance = actual - better;
          const variancePercent = better > 0 ? ((actual - better) / better) * 100 : null;

          return {
            month: m,
            good,
            better,
            best,
            actual,
            variance,
            variancePercent,
            initiatives,
          };
        });

        const data = await Promise.all(monthPromises);
        setMonthsData(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load summary data';
        setError(message);
        console.error('Error loading monthly summary:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAllMonths();
  }, [companyId]);

  const handleExportCSV = () => {
    const headers = [
      'Month',
      'Good',
      'Better',
      'Best',
      'Actual',
      '$ Variance',
      '% Variance',
      'Initiatives',
      'Status',
    ];

    const rows = monthsData.map((m) => {
      const status = m.month === currentMonth ? 'Current' : m.month < currentMonth ? 'Complete' : 'Upcoming';
      return [
        `${MONTH_NAMES[m.month - 1]} ${YEAR}`,
        m.good.toFixed(2),
        m.better.toFixed(2),
        m.best.toFixed(2),
        m.actual.toFixed(2),
        m.variance.toFixed(2),
        m.variancePercent !== null ? m.variancePercent.toFixed(1) + '%' : 'N/A',
        m.initiatives.length.toString(),
        status,
      ];
    });

    // Add year total row
    const totals = monthsData.reduce(
      (acc, m) => ({
        good: acc.good + m.good,
        better: acc.better + m.better,
        best: acc.best + m.best,
        actual: acc.actual + m.actual,
      }),
      { good: 0, better: 0, best: 0, actual: 0 }
    );
    const totalVariance = totals.actual - totals.better;
    const totalVariancePct = totals.better > 0 ? ((totals.actual - totals.better) / totals.better) * 100 : null;
    const totalInitiatives = monthsData.reduce((sum, m) => sum + m.initiatives.length, 0);

    rows.push([
      'YEAR TOTAL',
      totals.good.toFixed(2),
      totals.better.toFixed(2),
      totals.best.toFixed(2),
      totals.actual.toFixed(2),
      totalVariance.toFixed(2),
      totalVariancePct !== null ? totalVariancePct.toFixed(1) + '%' : 'N/A',
      totalInitiatives.toString(),
      '',
    ]);

    exportToCSV(`monthly-summary-${YEAR}.csv`, headers, rows);
  };

  const toggleExpand = (month: number) => {
    setExpandedMonth(expandedMonth === month ? null : month);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-destructive/50 bg-destructive/5 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Year totals
  const yearTotals = monthsData.reduce(
    (acc, m) => ({
      good: acc.good + m.good,
      better: acc.better + m.better,
      best: acc.best + m.best,
      actual: acc.actual + m.actual,
      initiatives: acc.initiatives + m.initiatives.length,
    }),
    { good: 0, better: 0, best: 0, actual: 0, initiatives: 0 }
  );
  const yearVariance = yearTotals.actual - yearTotals.better;
  const yearVariancePct = yearTotals.better > 0 ? ((yearTotals.actual - yearTotals.better) / yearTotals.better) * 100 : null;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          All 12 months with good, better, and best revenue targets. Click a row to drill into its initiatives.
        </p>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-lg)] border border-border bg-card text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <Link
            href="/initiatives"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-lg)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Initiative
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[hsl(var(--muted))]/50">
              <th className="text-left py-3 px-4 font-medium text-[hsl(var(--foreground-muted))]">Month</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Good</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Better</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Best</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Actual</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">$ Variance</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">% Variance</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Initiatives</th>
              <th className="text-center py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {monthsData.map((m) => (
              <MonthRow
                key={m.month}
                data={m}
                year={YEAR}
                isCurrent={m.month === currentMonth}
                isExpanded={expandedMonth === m.month}
                onToggle={() => toggleExpand(m.month)}
              />
            ))}
            {/* Year Total Row */}
            <tr className="bg-[hsl(var(--muted))]/30 font-semibold">
              <td className="py-3 px-4 text-[hsl(var(--foreground))]">YEAR TOTAL</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearTotals.good)}</td>
              <td className="text-right py-3 px-3 font-bold text-[hsl(var(--foreground))]">{formatCurrency(yearTotals.better)}</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearTotals.best)}</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearTotals.actual)}</td>
              <td className={`text-right py-3 px-3 ${yearVariance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(yearVariance)}
              </td>
              <td className={`text-right py-3 px-3 ${yearVariancePct !== null && yearVariancePct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {yearVariancePct !== null ? formatPercent(yearVariancePct) : '—'}
              </td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{yearTotals.initiatives}</td>
              <td className="text-center py-3 px-3">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* --- Month Row with expandable initiatives --- */

interface MonthRowProps {
  data: MonthData;
  year: number;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function MonthRow({ data, year, isCurrent, isExpanded, onToggle }: MonthRowProps) {
  const { month, good, better, best, actual, variance, variancePercent, initiatives } = data;
  const hasData = good > 0 || better > 0 || best > 0 || actual > 0 || initiatives.length > 0;

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-[hsl(var(--muted))]/30 transition-colors"
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
            )}
            <span className={`font-medium text-[hsl(var(--foreground))] ${isCurrent ? 'font-bold underline' : ''}`}>
              {MONTH_NAMES[month - 1]} {year}
            </span>
            {isCurrent && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
                NOW
              </span>
            )}
          </div>
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(good) : '—'}
        </td>
        <td className="text-right py-3 px-3 font-bold text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(better) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(best) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(actual) : '—'}
        </td>
        <td className={`text-right py-3 px-3 font-medium ${hasData ? (variance >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-[hsl(var(--foreground-muted))]'}`}>
          {hasData ? formatCurrency(variance) : '—'}
        </td>
        <td className={`text-right py-3 px-3 font-medium ${hasData && variancePercent !== null ? (variancePercent >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-[hsl(var(--foreground-muted))]'}`}>
          {hasData && variancePercent !== null ? formatPercent(variancePercent) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{initiatives.length}</td>
        <td className="text-center py-3 px-3">
          <MonthStatusBadge month={month} currentMonth={getCurrentMonth()} />
        </td>
      </tr>
      {/* Expanded initiative rows */}
      {isExpanded && initiatives.length > 0 && (
        <>
          {initiatives.map((initiative) => (
            <InitiativeChildRow key={initiative.id} initiative={initiative} />
          ))}
        </>
      )}
      {isExpanded && initiatives.length === 0 && (
        <tr>
          <td colSpan={9} className="py-3 px-4 pl-12 text-sm text-[hsl(var(--foreground-muted))] italic">
            No initiatives in this month.
          </td>
        </tr>
      )}
    </>
  );
}

/* --- Initiative child row --- */

interface InitiativeChildRowProps {
  initiative: Initiative;
}

function InitiativeChildRow({ initiative }: InitiativeChildRowProps) {
  const { revenueScenarios, status } = initiative;
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.planned;

  const eventDate = initiative.eventDate || initiative.activationDate;

  return (
    <tr className="bg-[hsl(var(--muted))]/20">
      <td className="py-2.5 px-4 pl-12">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full shrink-0 ${statusColor.dot}`} />
          <Link
            href={`/initiatives/${initiative.id}`}
            className="text-sm text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] hover:underline truncate max-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            {initiative.name}
          </Link>
          <span className="text-xs text-[hsl(var(--foreground-muted))] capitalize shrink-0">
            {initiative.kind.replace('-', ' ')}
          </span>
          <span className="text-xs text-[hsl(var(--foreground-muted))] shrink-0">
            {formatDate(eventDate)}
          </span>
        </div>
      </td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">
        {formatCurrency(revenueScenarios.good)}
      </td>
      <td className="text-right py-2.5 px-3 text-sm font-medium text-[hsl(var(--foreground))]">
        {formatCurrency(revenueScenarios.better)}
      </td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">
        {formatCurrency(revenueScenarios.best)}
      </td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">—</td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">—</td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">—</td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">—</td>
      <td className="text-center py-2.5 px-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor.badge}`}>
          {status.replace('_', ' ')}
        </span>
      </td>
    </tr>
  );
}

/* --- Month Status Badge --- */

function MonthStatusBadge({ month, currentMonth }: { month: number; currentMonth: number }) {
  if (month < currentMonth) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
        Complete
      </span>
    );
  }
  if (month === currentMonth) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
        In Progress
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
      Upcoming
    </span>
  );
}
