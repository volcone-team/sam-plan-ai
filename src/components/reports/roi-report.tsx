'use client';

import { useCompanyId } from '@/hooks/use-auth';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown, DollarSign, Percent, BarChart3 } from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { resultService } from '@/services/result.service';
import { initiativeTypeService } from '@/services/initiative-type.service';
import { expenseService } from '@/services/expense.service';
import { formatMoney, formatMoneyPrecise } from '@/lib/format-money';
import {
  buildRoiReport,
  sumExpensesByInitiative,
  type RoiRow,
  type RoiTypeRow,
} from '@/lib/initiative-spend';

export function ROIReport() {
  const companyId = useCompanyId() || "";
  const router = useRouter();
  const [initiativeROIs, setInitiativeROIs] = useState<RoiRow[]>([]);
  const [typeROIs, setTypeROIs] = useState<RoiTypeRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalSpend, setTotalSpend] = useState(0);
  const [unattributedSpend, setUnattributedSpend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    async function loadData() {
      setLoading(true);
      setLoadError(null);
      try {
        // Expenses: same call and RLS scope as Reports > Expenses, loaded once.
        const [initiatives, types, expenses] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          initiativeTypeService.getAllInitiativeTypes(),
          expenseService.getAllExpenses(),
        ]);

        const revenues = await Promise.all(
          initiatives.map(i => resultService.getTotalRevenueByInitiative(i.id))
        );
        const revenueById = new Map<string, number>(
          initiatives.map((i, idx) => [i.id, revenues[idx]])
        );

        // Actual spend = Σ recorded expenses (D2). Never initiatives.actual_spend.
        const report = buildRoiReport({
          initiatives,
          revenueById,
          spendById: sumExpensesByInitiative(expenses),
          typeNameById: new Map<string, string>(types.map(t => [t.id, t.name])),
          companyExpenseTotal: expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
        });

        setInitiativeROIs(report.rows);
        setTypeROIs(report.typeRows);
        setTotalRevenue(report.totalRevenue);
        setTotalSpend(report.totalSpend);
        setUnattributedSpend(report.unattributedSpend);
      } catch (err) {
        console.error('Failed to load ROI report data:', err);
        // Don't fall back to spend 0: say the figures could not be loaded.
        setLoadError('Could not load ROI data (initiatives, results or expenses). Please try again.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [companyId]);

  const netProfit = totalRevenue - totalSpend;
  const overallROI = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : null;
  const isPositiveROI = overallROI !== null && overallROI >= 0;

  // Initiatives with spend > 0 for ranking chart
  const rankedInitiatives = useMemo(() => {
    return initiativeROIs.filter(i => i.spend > 0 && i.roi !== null);
  }, [initiativeROIs]);

  const maxROI = rankedInitiatives.length > 0
    ? Math.max(...rankedInitiatives.map(i => Math.abs(i.roi!)))
    : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-[hsl(var(--foreground-muted))]">Loading ROI data...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Overall ROI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Total Revenue</p>
            <DollarSign className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatMoney(totalRevenue)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">All initiatives</p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Total Spend</p>
            <DollarSign className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatMoney(totalSpend)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">Recorded expenses</p>
          {unattributedSpend > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {Number.isInteger(unattributedSpend)
                ? formatMoney(unattributedSpend)
                : formatMoneyPrecise(unattributedSpend)} of expenses aren&apos;t linked to an initiative in this list.
            </p>
          )}
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Net Profit</p>
            {netProfit >= 0 ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </div>
          <p className={`mt-2 text-2xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {formatMoney(netProfit)}
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">Revenue − Spend</p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Overall ROI</p>
            <Percent className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className={`mt-2 text-2xl font-bold ${
            overallROI === null ? 'text-gray-400' : isPositiveROI ? 'text-emerald-600' : 'text-red-500'
          }`}>
            {overallROI !== null ? `${overallROI >= 0 ? '+' : ''}${overallROI.toFixed(1)}%` : 'N/A'}
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">(Revenue − Spend) / Spend × 100</p>
        </div>
      </div>

      {/* Per-Initiative ROI Table */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Per-Initiative ROI</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--muted)/.5)]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Initiative Name</th>
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Type</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Revenue</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Spend</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Net</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">ROI %</th>
                <th className="px-4 py-3 text-center font-medium text-[hsl(var(--foreground-muted))]">Status</th>
              </tr>
            </thead>
            <tbody>
              {initiativeROIs.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-b-0 hover:bg-[hsl(var(--muted)/.3)] transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    <button
                      onClick={() => router.push(`/initiatives/${row.id}`)}
                      className="text-left hover:text-[hsl(var(--primary))] hover:underline transition-colors"
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">{row.typeName}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.revenue)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.spend)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${
                    row.net >= 0 ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {formatMoney(row.net)}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${
                    row.roi === null ? 'text-gray-400' : row.roi >= 0 ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {row.roi !== null ? `${row.roi >= 0 ? '+' : ''}${row.roi.toFixed(1)}%` : 'N/A'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusStyles(row.status)}`}>
                      {formatStatus(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ROI Ranking (Horizontal Bars) */}
      {rankedInitiatives.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">ROI Ranking</h3>
          <div className="space-y-3">
            {rankedInitiatives.map((item, idx) => {
              const barWidth = (Math.abs(item.roi!) / maxROI) * 100;
              const isPositive = item.roi! >= 0;
              const isTopPerformer = idx < 3;

              return (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {isTopPerformer && (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                          {idx + 1}
                        </span>
                      )}
                      <span className={`font-medium ${isTopPerformer ? 'text-[hsl(var(--foreground))]' : ''}`}>
                        {item.name}
                      </span>
                    </div>
                    <span className={`font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPositive ? '+' : ''}{item.roi!.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isPositive ? 'bg-emerald-500' : 'bg-red-400'
                      } ${isTopPerformer ? 'opacity-100' : 'opacity-70'}`}
                      style={{ width: `${Math.max(barWidth, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ROI by Initiative Type */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">ROI by Initiative Type</h3>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">Aggregate ROI grouped by channel</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--muted)/.5)]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Type</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Total Revenue</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Total Spend</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Aggregate ROI %</th>
              </tr>
            </thead>
            <tbody>
              {typeROIs.map((row) => (
                <tr
                  key={row.typeId}
                  className="border-b border-border last:border-b-0 hover:bg-[hsl(var(--muted)/.3)] transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{row.typeName}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.totalRevenue)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.totalSpend)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${
                    row.roi === null ? 'text-gray-400' : row.roi >= 0 ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {row.roi !== null ? `${row.roi >= 0 ? '+' : ''}${row.roi.toFixed(1)}%` : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-[hsl(var(--muted)/.3)]">
                <td className="px-4 py-3 font-semibold">Total</td>
                <td className="px-4 py-3 text-right font-semibold">{formatMoney(totalRevenue)}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatMoney(totalSpend)}</td>
                <td className={`px-4 py-3 text-right font-bold ${
                  overallROI === null ? 'text-gray-400' : isPositiveROI ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {overallROI !== null ? `${overallROI >= 0 ? '+' : ''}${overallROI.toFixed(1)}%` : 'N/A'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Utility ---

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusStyles(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700';
    case 'launched':
    case 'in_progress':
      return 'bg-blue-50 text-blue-700';
    case 'planned':
      return 'bg-amber-50 text-amber-700';
    case 'paused':
      return 'bg-gray-100 text-gray-600';
    case 'retired':
      return 'bg-purple-50 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
