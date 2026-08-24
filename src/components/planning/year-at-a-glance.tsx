'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState } from 'react';
import {
  Target,
  DollarSign,
  TrendingUp,
  Layers,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ListTodo,
  BarChart3,
} from 'lucide-react';
import { planService } from '@/services/plan.service';
import { projectionService } from '@/services/projection.service';
import { initiativeService } from '@/services/initiative.service';
import { productService } from '@/services/product.service';
import { resultService } from '@/services/result.service';
import { taskService } from '@/services/task.service';
import { RevenueChart } from './revenue-chart';
import { InitiativeTimeline } from './initiative-timeline';
import type { AnnualPlan, QuarterlyPlan, Initiative, Task, Result } from '@/types';

const YEAR = 2026;

interface MonthlyData {
  month: number;
  good: number;
  better: number;
  best: number;
}

interface ProductRevenue {
  productId: string;
  productName: string;
  good: number;
  better: number;
  best: number;
}

interface TimelineInitiative {
  id: string;
  name: string;
  status: string;
  activationDate: Date;
  eventDate?: Date;
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

export function YearAtAGlance() {
  const companyId = useCompanyId() || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annualPlan, setAnnualPlan] = useState<AnnualPlan | null>(null);
  const [quarterlyPlans, setQuarterlyPlans] = useState<QuarterlyPlan[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [productRevenues, setProductRevenues] = useState<ProductRevenue[]>([]);
  const [initiatives, setInitiatives] = useState<TimelineInitiative[]>([]);
  const [projectionTotals, setProjectionTotals] = useState({
    good: 0,
    better: 0,
    best: 0,
  });
  const [overdueTasks, setOverdueTasks] = useState<(Task & { initiativeName: string })[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<(Task & { initiativeName: string })[]>([]);
  const [recentResults, setRecentResults] = useState<Result[]>([]);
  const [totalActualRevenue, setTotalActualRevenue] = useState(0);
  const [totalActualSpend, setTotalActualSpend] = useState(0);

  useEffect(() => {
    if (!companyId) return;
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [plan, quarters, projections, products, initiativesData] = await Promise.all([
          planService.getAnnualPlan(companyId, YEAR),
          planService.getQuarterlyPlans(companyId, YEAR),
          projectionService.getProjectionsByCompany(companyId),
          productService.getProductsByCompany(companyId),
          initiativeService.getInitiativesByCompany(companyId),
        ]);

        setAnnualPlan(plan);
        setQuarterlyPlans(quarters);

        // Build monthly data from projections
        const goodProj = projections.find(p => p.scenario === 'good');
        const betterProj = projections.find(p => p.scenario === 'better');
        const bestProj = projections.find(p => p.scenario === 'best');

        const monthly: MonthlyData[] = [];
        for (let m = 1; m <= 12; m++) {
          monthly.push({
            month: m,
            good: goodProj?.monthly?.find((x: any) => x.month === m)?.revenue || 0,
            better: betterProj?.monthly?.find((x: any) => x.month === m)?.revenue || 0,
            best: bestProj?.monthly?.find((x: any) => x.month === m)?.revenue || 0,
          });
        }
        setMonthlyData(monthly);

        // Calculate totals
        const goodTotal = monthly.reduce((sum, m) => sum + m.good, 0);
        const betterTotal = monthly.reduce((sum, m) => sum + m.better, 0);
        const bestTotal = monthly.reduce((sum, m) => sum + m.best, 0);
        setProjectionTotals({ good: goodTotal, better: betterTotal, best: bestTotal });

        // Build product revenue data
        const productMap = new Map(products.map(p => [p.id, p.name]));
        const [goodByProduct, betterByProduct, bestByProduct] = await Promise.all([
          projectionService.getProjectedRevenueByProduct(companyId, 'good'),
          projectionService.getProjectedRevenueByProduct(companyId, 'better'),
          projectionService.getProjectedRevenueByProduct(companyId, 'best'),
        ]);

        const productRevMap = new Map<string, ProductRevenue>();
        for (const item of goodByProduct) {
          productRevMap.set(item.productId, {
            productId: item.productId,
            productName: productMap.get(item.productId) || 'Unknown Product',
            good: item.revenue,
            better: 0,
            best: 0,
          });
        }
        for (const item of betterByProduct) {
          const existing = productRevMap.get(item.productId);
          if (existing) {
            existing.better = item.revenue;
          } else {
            productRevMap.set(item.productId, {
              productId: item.productId,
              productName: productMap.get(item.productId) || 'Unknown Product',
              good: 0,
              better: item.revenue,
              best: 0,
            });
          }
        }
        for (const item of bestByProduct) {
          const existing = productRevMap.get(item.productId);
          if (existing) {
            existing.best = item.revenue;
          } else {
            productRevMap.set(item.productId, {
              productId: item.productId,
              productName: productMap.get(item.productId) || 'Unknown Product',
              good: 0,
              better: 0,
              best: item.revenue,
            });
          }
        }
        setProductRevenues(Array.from(productRevMap.values()));

        // Build initiative timeline data
        const timelineInitiatives: TimelineInitiative[] = initiativesData.map((i: Initiative) => ({
          id: i.id,
          name: i.name,
          status: i.status,
          activationDate: i.activationDate,
          eventDate: i.eventDate,
        }));
        setInitiatives(timelineInitiatives);

        // --- Dashboard/Accountability data ---
        const now = new Date();
        const allTasksArr: (Task & { initiativeName: string })[] = [];

        for (const init of initiativesData) {
          const initTasks = await taskService.getTasksByInitiative(init.id);
          initTasks.forEach(t => {
            allTasksArr.push({ ...t, initiativeName: init.name });
          });
        }

        // Overdue tasks
        const overdue = allTasksArr.filter(t => {
          const due = new Date(t.dueDate);
          return due < now && t.status !== 'completed' && t.status !== 'cancelled';
        }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        setOverdueTasks(overdue.slice(0, 5));

        // Upcoming tasks (next 7 days, not completed)
        const weekFromNow = new Date(now);
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        const upcoming = allTasksArr.filter(t => {
          const due = new Date(t.dueDate);
          return due >= now && due <= weekFromNow && t.status !== 'completed' && t.status !== 'cancelled';
        }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        setUpcomingTasks(upcoming.slice(0, 8));

        // Recent results (last 4 weeks)
        const fourWeeksAgo = new Date(now);
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
        const results = await resultService.getResultsByDateRange(fourWeeksAgo, now);
        setRecentResults(results.slice(0, 5));
        setTotalActualRevenue(results.reduce((sum: number, r: Result) => sum + r.actualRevenue, 0));
        setTotalActualSpend(results.reduce((sum: number, r: Result) => sum + r.actualSpend, 0));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
        console.error('Error loading year-at-a-glance data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [companyId]);

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

  return (
    <div className="space-y-6">
      {/* Annual Revenue Targets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <TargetCard
          label="Baseline Revenue"
          value={formatCurrency(annualPlan?.baselineRevenue || 0)}
          icon={<Target className="h-4 w-4" />}
          variant="default"
        />
        <TargetCard
          label="Stretch Revenue"
          value={formatCurrency(annualPlan?.stretchRevenue || 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          variant="default"
        />
        <TargetCard
          label="Good Projection"
          value={formatCurrency(projectionTotals.good)}
          icon={<Layers className="h-4 w-4" />}
          variant="amber"
        />
        <TargetCard
          label="Better Projection"
          value={formatCurrency(projectionTotals.better)}
          icon={<Layers className="h-4 w-4" />}
          variant="blue"
        />
        <TargetCard
          label="Best Projection"
          value={formatCurrency(projectionTotals.best)}
          icon={<Layers className="h-4 w-4" />}
          variant="emerald"
        />
      </div>

      {/* Accountability Alerts */}
      {(overdueTasks.length > 0 || totalActualRevenue === 0) && (
        <div className="rounded-[var(--radius-lg)] border border-amber-200 bg-amber-50/50 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">Needs Attention</h3>
          </div>
          <div className="space-y-2">
            {overdueTasks.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <Clock className="h-4 w-4 shrink-0" />
                <span><strong>{overdueTasks.length} overdue task{overdueTasks.length !== 1 ? 's' : ''}</strong> need completion</span>
              </div>
            )}
            {totalActualRevenue === 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <BarChart3 className="h-4 w-4 shrink-0" />
                <span>No results entered yet — enter actuals to track progress</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actual vs Projected Summary */}
      {totalActualRevenue > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <h3 className="text-lg font-semibold">Actual Performance (YTD)</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
              <span className="text-xs font-medium text-emerald-500">Actual Revenue</span>
              <p className="text-lg font-bold">{formatCurrency(totalActualRevenue)}</p>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
              <span className="text-xs font-medium text-amber-500">Actual Spend</span>
              <p className="text-lg font-bold">{formatCurrency(totalActualSpend)}</p>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
              <span className="text-xs font-medium text-blue-500">vs Better Projection</span>
              <p className="text-lg font-bold">
                {projectionTotals.better > 0
                  ? `${((totalActualRevenue / projectionTotals.better) * 100).toFixed(1)}%`
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Tasks */}
      {upcomingTasks.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ListTodo className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">Upcoming Tasks (Next 7 Days)</h3>
            <span className="ml-auto text-xs text-[hsl(var(--foreground-muted))]">{upcomingTasks.length} tasks</span>
          </div>
          <div className="space-y-2">
            {upcomingTasks.map(task => (
              <div key={task.id} className="flex items-center gap-3 py-2 px-3 rounded-[var(--radius-md)] border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.name}</p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))] truncate">{task.initiativeName}</p>
                </div>
                <span className="text-xs text-[hsl(var(--foreground-muted))] whitespace-nowrap">
                  {formatDate(task.dueDate)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Results */}
      {recentResults.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">Recent Results</h3>
          </div>
          <div className="space-y-2">
            {recentResults.map(result => (
              <div key={result.id} className="flex items-center justify-between py-2 px-3 rounded-[var(--radius-md)] border border-border">
                <span className="text-xs text-[hsl(var(--foreground-muted))]">
                  {formatDate(result.weekStartDate)} – {formatDate(result.weekEndDate)}
                </span>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-emerald-600">{formatCurrency(result.actualRevenue)}</span>
                  <span className="text-sm text-[hsl(var(--foreground-muted))]">spent {formatCurrency(result.actualSpend)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Revenue Chart */}
      <RevenueChart data={monthlyData} />

      {/* Initiative Timeline */}
      <InitiativeTimeline initiatives={initiatives} />

      {/* Revenue by Product */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">Revenue by Product</h3>
          </div>
          <a
            href="/products"
            className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--primary))] hover:underline"
          >
            View Products →
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {productRevenues.map((product) => {
            const maxVal = Math.max(product.good, product.better, product.best);
            return (
              <div
                key={product.productId}
                className="rounded-[var(--radius-lg)] border border-border p-4 space-y-3"
              >
                <h4 className="text-sm font-semibold truncate">{product.productName}</h4>
                <div className="space-y-2">
                  <ProductBar label="Good" value={product.good} max={maxVal} color="bg-amber-500" />
                  <ProductBar label="Better" value={product.better} max={maxVal} color="bg-blue-500" />
                  <ProductBar label="Best" value={product.best} max={maxVal} color="bg-emerald-500" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quarterly Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quarterlyPlans.map((q) => (
          <div
            key={q.id}
            className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[hsl(var(--foreground-muted))]">
                Q{q.quarter} {q.year}
              </span>
              <Target className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
            </div>
            <p className="text-2xl font-bold">{formatCurrency(q.targetRevenue)}</p>
            <p className="text-xs text-[hsl(var(--foreground-muted))] line-clamp-2">
              {q.notes}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --- Sub-components --- */

interface TargetCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  variant: 'default' | 'amber' | 'blue' | 'emerald';
}

function TargetCard({ label, value, icon, variant }: TargetCardProps) {
  const accentClasses = {
    default: 'text-[hsl(var(--foreground-muted))]',
    amber: 'text-amber-500',
    blue: 'text-blue-500',
    emerald: 'text-emerald-500',
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4 space-y-2">
      <div className={`flex items-center gap-1.5 ${accentClasses[variant]}`}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

interface ProductBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

function ProductBar({ label, value, max, color }: ProductBarProps) {
  const widthPct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-10 text-[hsl(var(--foreground-muted))]">{label}</span>
      <div className="flex-1 h-2 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.max(widthPct, 2)}%` }}
        />
      </div>
      <span className="text-[10px] font-medium w-12 text-right">
        {formatCurrency(value)}
      </span>
    </div>
  );
}
