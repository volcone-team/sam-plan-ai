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

const YEAR = 2026;

const QUARTER_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

function getCurrentQuarter(): number {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function getQuarterDateRange(quarter: number, year: number): { start: Date; end: Date } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
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

// formatDate imported from @/lib/format-date

interface QuarterData {
  quarter: number;
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

export function QuarterlySummaryTable() {
  const companyId = useCompanyId() || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quartersData, setQuartersData] = useState<QuarterData[]>([]);
  const [expandedQuarter, setExpandedQuarter] = useState<number | null>(null);

  const currentQuarter = getCurrentQuarter();

  useEffect(() => {
    if (!companyId) return;
    const loadAllQuarters = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch projections once
        const projections = await projectionService.getProjectionsByCompany(companyId);
        const goodProj = projections.find(p => p.scenario === 'good');
        const betterProj = projections.find(p => p.scenario === 'better');
        const bestProj = projections.find(p => p.scenario === 'best');

        const sumMonths = (proj: Projection | undefined, months: number[]) => {
          if (!proj?.monthly) return 0;
          return (proj.monthly as any[])
            .filter((m: any) => months.includes(m.month))
            .reduce((sum: number, m: any) => sum + m.revenue, 0);
        };

        // Load data for all 4 quarters
        const quarterPromises = [1, 2, 3, 4].map(async (q) => {
          const months = QUARTER_MONTHS[q];
          const { start, end } = getQuarterDateRange(q, YEAR);

          const [results, initiatives] = await Promise.all([
            resultService.getResultsByDateRange(start, end),
            initiativeService.getInitiativesByDateRange(companyId, start, end),
          ]);

          const good = sumMonths(goodProj, months);
          const better = sumMonths(betterProj, months);
          const best = sumMonths(bestProj, months);
          const actual = results.reduce((sum, r) => sum + r.actualRevenue, 0);
          const variance = actual - better;
          const variancePercent = better > 0 ? ((actual - better) / better) * 100 : null;

          return {
            quarter: q,
            good,
            better,
            best,
            actual,
            variance,
            variancePercent,
            initiatives,
          };
        });

        const data = await Promise.all(quarterPromises);
        setQuartersData(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load summary data';
        setError(message);
        console.error('Error loading quarterly summary:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAllQuarters();
  }, [companyId]);

  const handleExportCSV = () => {
    const headers = [
      'Quarter',
      'Good',
      'Better',
      'Best',
      'Actual',
      '$ Variance',
      '% Variance',
      'Initiatives',
      'Status',
    ];

    const rows = quartersData.map((q) => {
      const status = q.quarter === currentQuarter ? 'Current' : q.quarter < currentQuarter ? 'Complete' : 'Upcoming';
      return [
        `Q${q.quarter} ${YEAR}`,
        q.good.toFixed(2),
        q.better.toFixed(2),
        q.best.toFixed(2),
        q.actual.toFixed(2),
        q.variance.toFixed(2),
        q.variancePercent !== null ? q.variancePercent.toFixed(1) + '%' : 'N/A',
        q.initiatives.length.toString(),
        status,
      ];
    });

    // Add year total row
    const totals = quartersData.reduce(
      (acc, q) => ({
        good: acc.good + q.good,
        better: acc.better + q.better,
        best: acc.best + q.best,
        actual: acc.actual + q.actual,
      }),
      { good: 0, better: 0, best: 0, actual: 0 }
    );
    const totalVariance = totals.actual - totals.better;
    const totalVariancePct = totals.better > 0 ? ((totals.actual - totals.better) / totals.better) * 100 : null;
    const totalInitiatives = quartersData.reduce((sum, q) => sum + q.initiatives.length, 0);

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

    exportToCSV(`quarterly-summary-${YEAR}.csv`, headers, rows);
  };

  const toggleExpand = (quarter: number) => {
    setExpandedQuarter(expandedQuarter === quarter ? null : quarter);
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
  const yearTotals = quartersData.reduce(
    (acc, q) => ({
      good: acc.good + q.good,
      better: acc.better + q.better,
      best: acc.best + q.best,
      actual: acc.actual + q.actual,
      initiatives: acc.initiatives + q.initiatives.length,
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
          See the quarters listed below with the good, better, and best revenue targets. Click a row to drill into its initiatives.
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
              <th className="text-left py-3 px-4 font-medium text-[hsl(var(--foreground-muted))]">Quarter</th>
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
            {quartersData.map((q) => (
              <QuarterRow
                key={q.quarter}
                data={q}
                year={YEAR}
                isCurrent={q.quarter === currentQuarter}
                isExpanded={expandedQuarter === q.quarter}
                onToggle={() => toggleExpand(q.quarter)}
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

/* --- Quarter Row with expandable initiatives --- */

interface QuarterRowProps {
  data: QuarterData;
  year: number;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function QuarterRow({ data, year, isCurrent, isExpanded, onToggle }: QuarterRowProps) {
  const { quarter, good, better, best, actual, variance, variancePercent, initiatives } = data;

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
            <span className="font-medium text-[hsl(var(--foreground))]">Q{quarter} {year}</span>
            {isCurrent && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
                NOW
              </span>
            )}
          </div>
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(good)}</td>
        <td className="text-right py-3 px-3 font-bold text-[hsl(var(--foreground))]">{formatCurrency(better)}</td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(best)}</td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(actual)}</td>
        <td className={`text-right py-3 px-3 font-medium ${variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {formatCurrency(variance)}
        </td>
        <td className={`text-right py-3 px-3 font-medium ${variancePercent !== null && variancePercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {variancePercent !== null ? formatPercent(variancePercent) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{initiatives.length}</td>
        <td className="text-center py-3 px-3">
          <QuarterStatusBadge quarter={quarter} currentQuarter={getCurrentQuarter()} />
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
            No initiatives in this quarter.
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

  // For initiative actual, we don't have per-initiative results loaded here,
  // so we display "—" for actual and variance at the initiative level
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

/* --- Quarter Status Badge --- */

function QuarterStatusBadge({ quarter, currentQuarter }: { quarter: number; currentQuarter: number }) {
  if (quarter < currentQuarter) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
        Complete
      </span>
    );
  }
  if (quarter === currentQuarter) {
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
