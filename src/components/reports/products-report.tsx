'use client';

import { useCompanyId } from '@/hooks/use-auth';

import { useState, useEffect, useMemo } from 'react';
import { Package, TrendingUp, Crown, BarChart3, Download } from 'lucide-react';
import { exportToCSV } from '@/lib/csv-export';
import { productService } from '@/services/product.service';
import { projectionService } from '@/services/projection.service';
import { resultService } from '@/services/result.service';
import { initiativeService } from '@/services/initiative.service';
import type { Product, Result, Initiative } from '@/types';

const CURRENT_YEAR = 2026;

// Product-specific colors for the bars
const PRODUCT_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
];

const PRODUCT_COLORS_LIGHT = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-purple-100 text-purple-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

interface ProductRevenueData {
  product: Product;
  actualRevenue: number;
  projectedRevenue: number;
  percentOfTotal: number;
  variance: number;
  variancePercent: number;
  monthlyRevenue: number[];
}

export function ProductsReport() {
  const companyId = useCompanyId() || "";
  const [products, setProducts] = useState<Product[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [projectedByProduct, setProjectedByProduct] = useState<Array<{ productId: string; revenue: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    async function loadData() {
      setLoading(true);
      try {
        const [productsData, resultsData, initiativesData, projData] = await Promise.all([
          productService.getProductsByCompany(companyId),
          resultService.getResultsByDateRange(
            new Date(`${CURRENT_YEAR}-01-01`),
            new Date(`${CURRENT_YEAR}-12-31`)
          ),
          initiativeService.getInitiativesByCompany(companyId),
          projectionService.getProjectedRevenueByProduct(companyId, 'better'),
        ]);
        setProducts(productsData);
        setResults(resultsData);
        setInitiatives(initiativesData);
        setProjectedByProduct(projData);
      } catch (err) {
        console.error('Failed to load products report data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [companyId]);

  // Build initiative → product mapping
  const initiativeProductMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const init of initiatives) {
      if (init.productId) {
        map.set(init.id, init.productId);
      }
    }
    return map;
  }, [initiatives]);

  // Calculate per-product revenue from results
  const productRevenueData: ProductRevenueData[] = useMemo(() => {
    // Aggregate actual revenue by product
    const revenueByProduct = new Map<string, number>();
    const monthlyByProduct = new Map<string, number[]>();

    // Initialize maps for all products
    for (const product of products) {
      revenueByProduct.set(product.id, 0);
      monthlyByProduct.set(product.id, Array(12).fill(0));
    }

    for (const result of results) {
      let productId: string | null = null;

      // Evergreen results have productId directly
      if ('productId' in result && result.productId) {
        productId = result.productId;
      }
      // Initiative results: look up the initiative's productId
      else if ('initiativeId' in result && result.initiativeId) {
        productId = initiativeProductMap.get(result.initiativeId) || null;
      }

      if (productId && revenueByProduct.has(productId)) {
        revenueByProduct.set(productId, (revenueByProduct.get(productId) || 0) + result.actualRevenue);

        // Track monthly
        const month = new Date(result.weekStartDate).getMonth();
        const monthly = monthlyByProduct.get(productId)!;
        monthly[month] += result.actualRevenue;
      }
    }

    // Total actual revenue across all products
    const totalActualRevenue = Array.from(revenueByProduct.values()).reduce((sum, v) => sum + v, 0);

    // Build product data array
    return products.map((product) => {
      const actualRevenue = revenueByProduct.get(product.id) || 0;
      const projEntry = projectedByProduct.find(p => p.productId === product.id);
      const projectedRevenue = projEntry?.revenue || 0;
      const percentOfTotal = totalActualRevenue > 0 ? (actualRevenue / totalActualRevenue) * 100 : 0;
      const variance = actualRevenue - projectedRevenue;
      const variancePercent = projectedRevenue > 0 ? (variance / projectedRevenue) * 100 : 0;
      const monthlyRevenue = monthlyByProduct.get(product.id) || Array(12).fill(0);

      return {
        product,
        actualRevenue,
        projectedRevenue,
        percentOfTotal,
        variance,
        variancePercent,
        monthlyRevenue,
      };
    }).sort((a, b) => b.actualRevenue - a.actualRevenue);
  }, [products, results, initiatives, projectedByProduct, initiativeProductMap]);

  // Total values
  const totalActualRevenue = productRevenueData.reduce((sum, d) => sum + d.actualRevenue, 0);
  const totalProjectedRevenue = productRevenueData.reduce((sum, d) => sum + d.projectedRevenue, 0);
  const topProduct = productRevenueData[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-[hsl(var(--foreground-muted))]">Loading products data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => {
            const headers = ['Product Name', 'Revenue (Actual)', 'Revenue (Projected)', 'Variance', 'Variance %', 'Share of Total'];
            const rows = productRevenueData.map(data => [
              data.product.name,
              data.actualRevenue.toString(),
              data.projectedRevenue.toString(),
              data.variance.toString(),
              `${data.variancePercent.toFixed(1)}%`,
              `${data.percentOfTotal.toFixed(1)}%`,
            ]);
            exportToCSV('products-report.csv', headers, rows);
          }}
          className="flex items-center gap-2 border border-border px-3 py-2 text-sm rounded-[var(--radius-md)] hover:bg-[hsl(var(--muted))] transition-colors"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Product Revenue Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {productRevenueData.map((data, idx) => {
          const isTop = idx === 0 && data.actualRevenue > 0;
          return (
            <div
              key={data.product.id}
              className={`rounded-[var(--radius-lg)] border bg-card p-4 ${
                isTop ? 'border-amber-300 ring-1 ring-amber-200' : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[hsl(var(--foreground-muted))] truncate pr-2">
                  {data.product.name}
                </p>
                {isTop ? (
                  <Crown className="h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <Package className="h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" />
                )}
              </div>
              <p className="mt-2 text-2xl font-bold">{formatCurrency(data.actualRevenue)}</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Projected: {formatCurrency(data.projectedRevenue)}
                </p>
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PRODUCT_COLORS_LIGHT[idx % PRODUCT_COLORS_LIGHT.length]}`}>
                  {data.percentOfTotal.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Product Mix Breakdown */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Product Mix Breakdown</h3>

        {/* Stacked bar */}
        {totalActualRevenue > 0 && (
          <div className="mb-4">
            <div className="flex h-8 w-full overflow-hidden rounded-[var(--radius-md)]">
              {productRevenueData.map((data, idx) => {
                const widthPercent = (data.actualRevenue / totalActualRevenue) * 100;
                if (widthPercent < 0.5) return null;
                return (
                  <div
                    key={data.product.id}
                    className={`${PRODUCT_COLORS[idx % PRODUCT_COLORS.length]} transition-all`}
                    style={{ width: `${widthPercent}%` }}
                    title={`${data.product.name}: ${formatCurrency(data.actualRevenue)} (${data.percentOfTotal.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Legend + individual bars */}
        <div className="space-y-3">
          {productRevenueData.map((data, idx) => {
            const barWidth = totalActualRevenue > 0 ? (data.actualRevenue / totalActualRevenue) * 100 : 0;
            return (
              <div key={data.product.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-3 w-3 rounded-sm ${PRODUCT_COLORS[idx % PRODUCT_COLORS.length]}`} />
                    <span className="font-medium">{data.product.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[hsl(var(--foreground-muted))]">
                    <span>{formatCurrency(data.actualRevenue)}</span>
                    <span className="text-xs">({data.percentOfTotal.toFixed(1)}%)</span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div
                    className={`h-full rounded-full ${PRODUCT_COLORS[idx % PRODUCT_COLORS.length]} transition-all`}
                    style={{ width: `${Math.max(barWidth, 0.5)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Product Performance Table */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Product Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--muted)/.5)]">
                <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Product Name</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Revenue (Actual)</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Revenue (Projected)</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Variance ($)</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Variance (%)</th>
                <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Share of Total</th>
              </tr>
            </thead>
            <tbody>
              {productRevenueData.map((data, idx) => {
                const isPositive = data.variance >= 0;
                return (
                  <tr
                    key={data.product.id}
                    className="border-b border-border last:border-b-0 hover:bg-[hsl(var(--muted)/.3)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-sm ${PRODUCT_COLORS[idx % PRODUCT_COLORS.length]}`} />
                        <span className="font-medium">{data.product.name}</span>
                        {idx === 0 && data.actualRevenue > 0 && (
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(data.actualRevenue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(data.projectedRevenue)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPositive ? '+' : ''}{formatCurrency(data.variance)}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                      {isPositive ? '+' : ''}{data.variancePercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRODUCT_COLORS_LIGHT[idx % PRODUCT_COLORS_LIGHT.length]}`}>
                        {data.percentOfTotal.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 border-border bg-[hsl(var(--muted)/.3)]">
                <td className="px-4 py-3 font-semibold">Total</td>
                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(totalActualRevenue)}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(totalProjectedRevenue)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${totalActualRevenue - totalProjectedRevenue >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {totalActualRevenue - totalProjectedRevenue >= 0 ? '+' : ''}{formatCurrency(totalActualRevenue - totalProjectedRevenue)}
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${totalActualRevenue - totalProjectedRevenue >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {totalProjectedRevenue > 0 ? `${((totalActualRevenue - totalProjectedRevenue) / totalProjectedRevenue * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-semibold">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Per-Product Monthly Trend (Sparklines) */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="mb-4 text-lg font-semibold">Monthly Revenue Trend by Product</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {productRevenueData.map((data, idx) => {
            const maxMonthly = Math.max(...data.monthlyRevenue, 1);
            const hasData = data.monthlyRevenue.some(v => v > 0);
            return (
              <div key={data.product.id} className="rounded-[var(--radius-md)] border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-3 w-3 rounded-sm ${PRODUCT_COLORS[idx % PRODUCT_COLORS.length]}`} />
                    <span className="text-sm font-medium">{data.product.name}</span>
                  </div>
                  <span className="text-xs text-[hsl(var(--foreground-muted))]">
                    {formatCurrency(data.actualRevenue)} total
                  </span>
                </div>
                {hasData ? (
                  <div className="flex items-end gap-0.5" style={{ height: '48px' }}>
                    {data.monthlyRevenue.map((value, mIdx) => {
                      const height = (value / maxMonthly) * 100;
                      return (
                        <div
                          key={mIdx}
                          className={`flex-1 rounded-t-sm transition-all ${
                            value > 0 ? PRODUCT_COLORS[idx % PRODUCT_COLORS.length] : 'bg-[hsl(var(--muted))]'
                          }`}
                          style={{ height: `${Math.max(height, 4)}%` }}
                          title={`${MONTH_SHORT[mIdx]}: ${formatCurrency(value)}`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center" style={{ height: '48px' }}>
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">No revenue data yet</span>
                  </div>
                )}
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-[hsl(var(--foreground-muted))]">Jan</span>
                  <span className="text-[10px] text-[hsl(var(--foreground-muted))]">Dec</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- Constants ---

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// --- Utility ---

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
