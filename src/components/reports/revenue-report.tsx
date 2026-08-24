'use client';

import { useCompanyId } from '@/hooks/use-auth';

import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Target, Hash, Download } from 'lucide-react';
import { exportToCSV } from '@/lib/csv-export';
import { resultService } from '@/services/result.service';
import { projectionService } from '@/services/projection.service';
import type { Projection, Result } from '@/types';

const CURRENT_YEAR = 2026;

type PeriodView = 'monthly' | 'quarterly' | 'annual';

interface MonthlyData {
  month: number;
  year: number;
  label: string;
  projected: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function RevenueReport() {
  const companyId = useCompanyId() || "";
  const [periodView, setPeriodView] = useState<PeriodView>('monthly');
  const [projections, setProjections] = useState<Projection[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    async function loadData() {
      setLoading(true);
      try {
        const [projData, resultsData] = await Promise.all([
          projectionService.getProjectionsByScenario(companyId, 'better'),
          resultService.getResultsByDateRange(
            new Date(`${CURRENT_YEAR}-01-01`),
            new Date(`${CURRENT_YEAR}-12-31`)
          ),
        ]);
        setProjections(projData);
        setResults(resultsData);
      } catch (err) {
        console.error('Failed to load revenue data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [companyId]);

  // Build monthly data from projections and results
  const monthlyData: MonthlyData[] = useMemo(() => {
    const betterProjection = projections.find(p => p.scenario === 'better');
    const monthlyProjections = betterProjection?.monthly || [];

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const projectedEntry = monthlyProjections.find(m => m.month === month && m.year === CURRENT_YEAR);
      const projected = projectedEntry?.revenue || 0;

      // Sum actual revenue for this month from results
      const monthResults = results.filter(r => {
        const date = new Date(r.weekStartDate);
        return date.getFullYear() === CURRENT_YEAR && date.getMonth() === i;
      });
      const actual = monthResults.reduce((sum, r) => sum + r.actualRevenue, 0);

      const variance = actual - projected;
      const variancePercent = projected > 0 ? (variance / projected) * 100 : 0;

      return {
        month,
        year: CURRENT_YEAR,
        label: MONTH_NAMES[i],
        projected,
        actual,
        variance,
        variancePercent,
      };
    });
  }, [projections, results]);

  // Quarterly aggregation
  const quarterlyData = useMemo(() => {
    return [1, 2, 3, 4].map(q => {
      const startMonth = (q - 1) * 3;
      const quarterMonths = monthlyData.slice(startMonth, startMonth + 3);
      const projected = quarterMonths.reduce((sum, m) => sum + m.projected, 0);
      const actual = quarterMonths.reduce((sum, m) => sum + m.actual, 0);
      const variance = actual - projected;
      const variancePercent = projected > 0 ? (variance / projected) * 100 : 0;

      return {
        month: q,
        year: CURRENT_YEAR,
        label: `Q${q} ${CURRENT_YEAR}`,
        projected,
        actual,
        variance,
        variancePercent,
      };
    });
  }, [monthlyData]);

  // Annual aggregation
  const annualData = useMemo(() => {
    const projected = monthlyData.reduce((sum, m) => sum + m.projected, 0);
    const actual = monthlyData.reduce((sum, m) => sum + m.actual, 0);
    const variance = actual - projected;
    const variancePercent = projected > 0 ? (variance / projected) * 100 : 0;

    return [{
      month: 0,
      year: CURRENT_YEAR,
      label: `${CURRENT_YEAR}`,
      projected,
      actual,
      variance,
      variancePercent,
    }];
  }, [monthlyData]);

  // Get the appropriate data for the current period view
  const currentPeriodData = useMemo(() => {
    switch (periodView) {
      case 'quarterly': return quarterlyData;
      case 'annual': return annualData;
      default: return monthlyData;
    }
  }, [periodView, monthlyData, quarterlyData, annualData]);

  // Summary calculations (YTD)
  const currentMonth = 1; // January (only month with data in mock)
  const ytdData = monthlyData.slice(0, currentMonth);
  const totalActual = ytdData.reduce((sum, m) => sum + m.actual, 0);
  const totalProjected = ytdData.reduce((sum, m) => sum + m.projected, 0);
  const totalVariance = totalActual - totalProjected;
  const totalEntries = results.length;

  // Period comparison (current vs previous month)
  const currentMonthData = monthlyData[currentMonth - 1];
  const previousMonthData = currentMonth > 1 ? monthlyData[currentMonth - 2] : null;
  const periodChange = previousMonthData && previousMonthData.actual > 0
    ? ((currentMonthData.actual - previousMonthData.actual) / previousMonthData.actual) * 100
    : null;

  // Chart: find max value for scaling
  const chartData = periodView === 'monthly' ? monthlyData : periodView === 'quarterly' ? quarterlyData : annualData;
  const maxChartValue = Math.max(...chartData.map(d => Math.max(d.projected, d.actual)), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-[hsl(var(--foreground-muted))]">Loading revenue data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Selector + Export */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[hsl(var(--foreground-muted))]">View:</span>
        <div className="inline-flex rounded-[var(--radius-md)] border border-border bg-card">
          {(['monthly', 'quarterly', 'annual'] as PeriodView[]).map((period) => (
            <button
              key={period}
              onClick={() => setPeriodView(period)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors first:rounded-l-[var(--radius-md)] last:rounded-r-[var(--radius-md)] ${
                periodView === period
                  ? 'bg-[hsl(var(--primary))] text-white'
                  : 'text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--muted))]'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
        </div>
        <button
          onClick={() => {
            const headers = ['Period', 'Projected', 'Actual', 'Variance', 'Variance %', 'Status'];
            const rows = currentPeriodData.map(row => [
              row.label,
              row.projected.toString(),
              row.actual.toString(),
              row.variance.toString(),
              `${row.variancePercent.toFixed(1)}%`,
              row.variance >= 0 ? 'Over' : 'Under',
            ]);
            exportToCSV(`revenue-report-${periodView}.csv`, headers, rows);
          }}
          className="flex items-center gap-2 border border-border px-3 py-2 text-sm rounded-[var(--radius-md)] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Actual Revenue (YTD)"
          value={formatCurrency(totalActual)}
          icon={DollarSign}
          subtitle="Year to date"
        />
        <SummaryCard
          title="Projected Revenue (YTD)"
          value={formatCurrency(totalProjected)}
          icon={Target}
          subtitle="Better scenario"
        />
        <SummaryCard
          title="Variance"
          value={formatCurrency(Math.abs(totalVariance))}
          icon={totalVariance >= 0 ? TrendingUp : TrendingDown}
          subtitle={totalVariance >= 0 ? 'Over target' : 'Under target'}
          variant={totalVariance >= 0 ? 'positive' : 'negative'}
          prefix={totalVariance >= 0 ? '+' : '-'}
        />
        <SummaryCard
          title="Result Entries"
          value={totalEntries.toString()}
          icon={Hash}
          subtitle="Total data points"
        />
      </div>

      {/* Revenue vs Projected Chart */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Revenue vs Projected</h3>
        <div className="space-y-3">
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-[hsl(var(--foreground-muted))]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-[hsl(var(--primary))]" />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border-2 border-[hsl(var(--primary))] opacity-40" />
              Projected (Better)
            </span>
          </div>

          {/* Bars */}
          <div className="flex items-end gap-1 sm:gap-2" style={{ minHeight: '200px' }}>
            {chartData.map((item, idx) => {
              const actualHeight = (item.actual / maxChartValue) * 100;
              const projectedHeight = (item.projected / maxChartValue) * 100;
              const isOver = item.actual >= item.projected;

              return (
                <div key={idx} className="flex flex-1 flex-col items-center gap-1">
                  {/* Bars container */}
                  <div className="flex w-full items-end justify-center gap-0.5" style={{ height: '180px' }}>
                    {/* Actual bar */}
                    <div
                      className={`w-2/5 rounded-t-sm transition-all ${
                        isOver ? 'bg-emerald-500' : 'bg-red-400'
                      }`}
                      style={{ height: `${Math.max(actualHeight, 1)}%` }}
                      title={`Actual: ${formatCurrency(item.actual)}`}
                    />
                    {/* Projected bar */}
                    <div
                      className="w-2/5 rounded-t-sm border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.1)]"
                      style={{ height: `${Math.max(projectedHeight, 1)}%` }}
                      title={`Projected: ${formatCurrency(item.projected)}`}
                    />
                  </div>
                  {/* Label */}
                  <span className="text-[10px] text-[hsl(var(--foreground-muted))] sm:text-xs">
                    {periodView === 'monthly' ? MONTH_SHORT[item.month - 1] : item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Period Breakdown Table */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Period Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--muted)/.5)]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Period</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Projected (Better)</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Actual</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Variance ($)</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Variance (%)</th>
                <th className="px-4 py-3 text-center font-medium text-[hsl(var(--foreground-muted))]">Status</th>
              </tr>
            </thead>
            <tbody>
              {currentPeriodData.map((row, idx) => {
                const isPositive = row.variance >= 0;
                return (
                  <tr
                    key={idx}
                    className="border-b border-border last:border-b-0 hover:bg-[hsl(var(--muted)/.3)] transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.projected)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.actual)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPositive ? '+' : ''}{formatCurrency(row.variance)}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPositive ? '+' : ''}{row.variancePercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        isPositive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}>
                        {isPositive ? '↑' : '↓'} {isPositive ? 'Over' : 'Under'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Period Comparison */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">This Period vs Last Period</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">Current Month Revenue</p>
            <p className="text-xl font-bold">{formatCurrency(currentMonthData.actual)}</p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">{currentMonthData.label}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">Previous Month Revenue</p>
            <p className="text-xl font-bold">
              {previousMonthData ? formatCurrency(previousMonthData.actual) : '—'}
            </p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              {previousMonthData ? previousMonthData.label : 'N/A'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">Change</p>
            {periodChange !== null ? (
              <>
                <p className={`text-xl font-bold ${periodChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {periodChange >= 0 ? '+' : ''}{periodChange.toFixed(1)}%
                </p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  {periodChange >= 0 ? '↑ Trending up' : '↓ Trending down'}
                </p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-[hsl(var(--foreground-muted))]">—</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">Insufficient data</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Helper components ---

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle: string;
  variant?: 'default' | 'positive' | 'negative';
  prefix?: string;
}

function SummaryCard({ title, value, icon: Icon, subtitle, variant = 'default', prefix }: SummaryCardProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">{title}</p>
        <Icon className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
      </div>
      <p className={`mt-2 text-2xl font-bold ${
        variant === 'positive' ? 'text-emerald-600' :
        variant === 'negative' ? 'text-red-500' : ''
      }`}>
        {prefix}{value}
      </p>
      <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">{subtitle}</p>
    </div>
  );
}

// --- Utility ---

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
