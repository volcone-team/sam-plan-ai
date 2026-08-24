'use client';

import { useCompanyId } from '@/hooks/use-auth';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Receipt, Hash, TrendingUp, Download } from 'lucide-react';
import { exportToCSV } from '@/lib/csv-export';
import { expenseService } from '@/services/expense.service';
import { initiativeService } from '@/services/initiative.service';
import type { Expense, ExpenseCategory, Initiative } from '@/types';

const CURRENT_YEAR = 2026;

const CATEGORY_COLORS: Record<ExpenseCategory, { bg: string; text: string; bar: string }> = {
  advertising: { bg: 'bg-purple-100', text: 'text-purple-700', bar: 'bg-purple-500' },
  talent: { bg: 'bg-blue-100', text: 'text-blue-700', bar: 'bg-blue-500' },
  tools: { bg: 'bg-indigo-100', text: 'text-indigo-700', bar: 'bg-indigo-500' },
  production: { bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-500' },
  venue: { bg: 'bg-green-100', text: 'text-green-700', bar: 'bg-green-500' },
  fulfillment: { bg: 'bg-teal-100', text: 'text-teal-700', bar: 'bg-teal-500' },
  other: { bg: 'bg-gray-100', text: 'text-gray-700', bar: 'bg-gray-500' },
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  advertising: 'Advertising',
  talent: 'Talent',
  tools: 'Tools',
  production: 'Production',
  venue: 'Venue',
  fulfillment: 'Fulfillment',
  other: 'Other',
};

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function ExpensesReport() {
  const companyId = useCompanyId() || "";
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [breakdown, setBreakdown] = useState<Array<{ category: ExpenseCategory; total: number; count: number }>>([]);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [highestCategory, setHighestCategory] = useState<{ category: ExpenseCategory; total: number } | null>(null);
  const [averagePerInitiative, setAveragePerInitiative] = useState(0);
  const [monthlyTrend, setMonthlyTrend] = useState<Array<{ month: number; total: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    async function loadData() {
      setLoading(true);
      try {
        const [
          expensesData,
          initiativesData,
          breakdownData,
          total,
          highest,
          trend,
        ] = await Promise.all([
          expenseService.getAllExpenses(),
          initiativeService.getInitiativesByCompany(companyId),
          expenseService.getSpendingBreakdown(),
          expenseService.getTotalExpenses(),
          expenseService.getHighestSpendCategory(),
          expenseService.getMonthlySpenDTrend(CURRENT_YEAR),
        ]);

        setExpenses(expensesData);
        setInitiatives(initiativesData);
        setBreakdown(breakdownData);
        setTotalExpenses(total);
        setHighestCategory(highest);
        setMonthlyTrend(trend);

        // Calculate average per initiative
        const initiativeIds = initiativesData.map(i => i.id);
        const avg = await expenseService.getAverageSpendPerInitiative(initiativeIds);
        setAveragePerInitiative(avg);
      } catch (err) {
        console.error('Failed to load expenses report data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [companyId]);

  // Expenses by initiative
  const expensesByInitiative = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const expense of expenses) {
      const existing = map.get(expense.initiativeId) || { total: 0, count: 0 };
      existing.total += expense.amount;
      existing.count += 1;
      map.set(expense.initiativeId, existing);
    }

    const initiativeMap = new Map(initiatives.map(i => [i.id, i.name]));

    return Array.from(map.entries())
      .map(([initiativeId, data]) => ({
        initiativeId,
        name: initiativeMap.get(initiativeId) || 'Unknown Initiative',
        total: data.total,
        count: data.count,
      }))
      .sort((a, b) => b.total - a.total);
  }, [expenses, initiatives]);

  // Sorted expenses for detail table (newest first)
  const sortedExpenses = useMemo(() => {
    const initiativeMap = new Map(initiatives.map(i => [i.id, i.name]));
    return [...expenses]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map(e => ({
        ...e,
        initiativeName: initiativeMap.get(e.initiativeId) || 'Unknown',
      }));
  }, [expenses, initiatives]);

  // Monthly trend with full 12 months for chart
  const fullMonthlyTrend = useMemo(() => {
    const trendMap = new Map(monthlyTrend.map(m => [m.month, m.total]));
    return Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      total: trendMap.get(i + 1) || 0,
    }));
  }, [monthlyTrend]);

  const maxMonthlySpend = Math.max(...fullMonthlyTrend.map(m => m.total), 1);
  const maxCategoryTotal = breakdown.length > 0 ? Math.max(...breakdown.map(b => b.total)) : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-[hsl(var(--foreground-muted))]">Loading expenses data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => {
            const headers = ['Date', 'Initiative', 'Category', 'Description', 'Amount'];
            const rows = sortedExpenses.map(expense => [
              formatDate(expense.date),
              expense.initiativeName,
              CATEGORY_LABELS[expense.category],
              expense.description,
              expense.amount.toString(),
            ]);
            exportToCSV('expenses-report.csv', headers, rows);
          }}
          className="flex items-center gap-2 border border-border px-3 py-2 text-sm rounded-[var(--radius-md)] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Total Expenses</p>
            <DollarSign className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(totalExpenses)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">All time</p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Highest Spend Category</p>
            <TrendingUp className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {highestCategory ? CATEGORY_LABELS[highestCategory.category] : '—'}
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
            {highestCategory ? formatCurrency(highestCategory.total) : 'No data'}
          </p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Expense Entries</p>
            <Hash className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className="mt-2 text-2xl font-bold">{expenses.length}</p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">Total entries</p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Avg per Initiative</p>
            <Receipt className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          </div>
          <p className="mt-2 text-2xl font-bold">{formatCurrency(averagePerInitiative)}</p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">Average spend</p>
        </div>
      </div>

      {/* Expenses by Category */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Expenses by Category</h3>
        <div className="space-y-3">
          {breakdown.map((item) => {
            const colors = CATEGORY_COLORS[item.category];
            const barWidth = (item.total / maxCategoryTotal) * 100;
            const percentage = totalExpenses > 0 ? (item.total / totalExpenses) * 100 : 0;
            return (
              <div key={item.category} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-3 w-3 rounded-sm ${colors.bar}`} />
                    <span className="font-medium">{CATEGORY_LABELS[item.category]}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[hsl(var(--foreground-muted))]">
                    <span>{formatCurrency(item.total)}</span>
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div
                    className={`h-full rounded-full ${colors.bar} transition-all`}
                    style={{ width: `${Math.max(barWidth, 0.5)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expenses by Initiative */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Expenses by Initiative</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--muted)/.5)]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Initiative Name</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Total Expenses</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]"># of Entries</th>
              </tr>
            </thead>
            <tbody>
              {expensesByInitiative.map((row) => (
                <tr
                  key={row.initiativeId}
                  className="border-b border-border last:border-b-0 hover:bg-[hsl(var(--muted)/.3)] transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    <button
                      onClick={() => router.push(`/initiatives/${row.initiativeId}`)}
                      className="text-left hover:text-[hsl(var(--primary))] hover:underline transition-colors"
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.total)}</td>
                  <td className="px-4 py-3 text-right">{row.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-[hsl(var(--muted)/.3)]">
                <td className="px-4 py-3 font-semibold">Total</td>
                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(totalExpenses)}</td>
                <td className="px-4 py-3 text-right font-semibold">{expenses.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Monthly Spend Trend */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Monthly Spend Trend ({CURRENT_YEAR})</h3>
        <div className="flex items-end gap-1 sm:gap-2" style={{ minHeight: '200px' }}>
          {fullMonthlyTrend.map((item) => {
            const height = (item.total / maxMonthlySpend) * 100;
            return (
              <div key={item.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end justify-center" style={{ height: '180px' }}>
                  <div
                    className={`w-3/4 rounded-t-sm transition-all ${
                      item.total > 0 ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'
                    }`}
                    style={{ height: `${item.total > 0 ? Math.max(height, 2) : 4}%` }}
                    title={`${MONTH_SHORT[item.month - 1]}: ${formatCurrency(item.total)}`}
                  />
                </div>
                <span className="text-[10px] text-[hsl(var(--foreground-muted))] sm:text-xs">
                  {MONTH_SHORT[item.month - 1]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expense Detail Table */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Expense Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--muted)/.5)]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Date</th>
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Initiative</th>
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Category</th>
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Description</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sortedExpenses.map((expense) => {
                const colors = CATEGORY_COLORS[expense.category];
                return (
                  <tr
                    key={expense.id}
                    className="border-b border-border last:border-b-0 hover:bg-[hsl(var(--muted)/.3)] transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDate(expense.date)}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <button
                        onClick={() => router.push(`/initiatives/${expense.initiativeId}`)}
                        className="text-left hover:text-[hsl(var(--primary))] hover:underline transition-colors"
                      >
                        {expense.initiativeName}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>
                        {CATEGORY_LABELS[expense.category]}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[300px] truncate">{expense.description}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(expense.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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

function formatDate(date: Date): string {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}/${day}/${d.getFullYear()}`;
}
