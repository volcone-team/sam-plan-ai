'use client';

import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, BarChart3 } from 'lucide-react';
import type { Initiative } from '@/types';
import type { InitiativeType } from '@/types/initiative-type.types';
import { resultService } from '@/services/result.service';
import { expenseService } from '@/services/expense.service';
import { formatMoney } from '@/lib/format-money';
import { pickMoneyFormatter } from '@/lib/results-tab-totals';
import { sumExpensesByInitiative } from '@/lib/initiative-spend';

export interface InitiativeRevenueProps {
  initiative: Initiative;
  initiativeType: InitiativeType | null;
}

/**
 * Revenue & Financials tab.
 * Displays revenue scenarios, budget vs spend, ROI, and benchmark comparison.
 */
export function InitiativeRevenue({ initiative, initiativeType }: InitiativeRevenueProps) {
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  /** D2: actual spend = Σ this initiative's recorded expenses. */
  const [actualSpend, setActualSpend] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadActuals = async () => {
      // Independent loads: a failure in one leaves only that figure at 0.
      const [revenue, spend] = await Promise.allSettled([
        resultService.getTotalRevenueByInitiative(initiative.id),
        expenseService.getExpensesByInitiative(initiative.id),
      ]);
      if (revenue.status === 'fulfilled') setTotalRevenue(revenue.value);
      // Cents-safe, the same sum the ROI report and initiative cards use.
      if (spend.status === 'fulfilled') {
        setActualSpend(sumExpensesByInitiative(spend.value).get(initiative.id) ?? 0);
      }
      setLoading(false);
    };
    loadActuals();
  }, [initiative.id]);

  // Expenses can carry cents; show the budget line at the precision it needs.
  const formatSpend = pickMoneyFormatter([actualSpend, initiative.plannedBudget, totalRevenue]);

  const budgetUsedPercent = initiative.plannedBudget > 0
    ? Math.min((actualSpend / initiative.plannedBudget) * 100, 100)
    : 0;
  const isOverBudget = actualSpend > initiative.plannedBudget;

  const roi = actualSpend > 0
    ? ((totalRevenue - actualSpend) / actualSpend) * 100
    : null;

  return (
    <div className="space-y-8">
      {/* Revenue Scenarios */}
      <section aria-labelledby="revenue-scenarios-heading">
        <h2 id="revenue-scenarios-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[hsl(var(--primary))]" />
          Revenue Scenarios
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ScenarioCard
            label="Good"
            amount={initiative.revenueScenarios.good}
            description="Conservative projection"
            accentClass="border-l-yellow-500"
          />
          <ScenarioCard
            label="Better"
            amount={initiative.revenueScenarios.better}
            description="Moderate projection"
            accentClass="border-l-blue-500"
          />
          <ScenarioCard
            label="Best"
            amount={initiative.revenueScenarios.best}
            description="Aggressive projection"
            accentClass="border-l-green-500"
          />
        </div>
      </section>

      {/* Budget vs Spend */}
      <section aria-labelledby="budget-heading">
        <h2 id="budget-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-[hsl(var(--primary))]" />
          Budget vs Actual Spend
        </h2>
        <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[hsl(var(--foreground-muted))]">
              Actual spend (from expenses): {formatSpend(actualSpend)} of {formatSpend(initiative.plannedBudget)} planned
            </span>
            <span className={`text-sm font-semibold ${isOverBudget ? 'text-[hsl(var(--error))]' : 'text-[hsl(var(--foreground))]'}`}>
              {budgetUsedPercent.toFixed(0)}%
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-[hsl(var(--background-muted))]">
            <div
              className={`h-full rounded-full transition-all ${
                isOverBudget ? 'bg-[hsl(var(--error))]' : 'bg-[hsl(var(--primary))]'
              }`}
              style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }}
              role="progressbar"
              aria-valuenow={actualSpend}
              aria-valuemin={0}
              aria-valuemax={initiative.plannedBudget}
              aria-label="Budget utilization"
            />
          </div>
          {isOverBudget && (
            <p className="mt-2 text-xs text-[hsl(var(--error))]">
              Over budget by {formatSpend(actualSpend - initiative.plannedBudget)}
            </p>
          )}

          {/* ROI */}
          {!loading && roi !== null && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[hsl(var(--foreground-muted))]">ROI</span>
                <span className={`text-lg font-bold ${roi >= 0 ? 'text-[hsl(var(--success))]' : 'text-[hsl(var(--error))]'}`}>
                  {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                </span>
              </div>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Revenue: {formatSpend(totalRevenue)} | Spend (expenses): {formatSpend(actualSpend)}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Benchmark Comparison */}
      {initiativeType && (
        <section aria-labelledby="benchmark-heading">
          <h2 id="benchmark-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[hsl(var(--primary))]" />
            Benchmark Comparison
          </h2>
          <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[hsl(var(--background-muted))]">
                  <th className="px-4 py-3 text-left font-medium text-[hsl(var(--foreground-muted))]">Metric</th>
                  <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Conservative</th>
                  <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Moderate</th>
                  <th className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground-muted))]">Aggressive</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(initiativeType.benchmarks).map(([key, scenario]) => (
                  <tr key={key} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 font-medium text-[hsl(var(--foreground))] capitalize">
                      {key.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-right text-[hsl(var(--foreground-muted))]">
                      {formatBenchmarkValue(scenario.conservative)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[hsl(var(--foreground))]">
                      {formatBenchmarkValue(scenario.moderate)}
                    </td>
                    <td className="px-4 py-3 text-right text-[hsl(var(--primary))]">
                      {formatBenchmarkValue(scenario.aggressive)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ScenarioCard({
  label,
  amount,
  description,
  accentClass,
}: {
  label: string;
  amount: number;
  description: string;
  accentClass: string;
}) {
  const formatCurrency = formatMoney;

  return (
    <div className={`rounded-[var(--radius-lg)] border border-border bg-card p-5 border-l-4 ${accentClass}`}>
      <p className="text-xs font-medium text-[hsl(var(--foreground-muted))] uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-[hsl(var(--foreground))]">
        {formatCurrency(amount)}
      </p>
      <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{description}</p>
    </div>
  );
}

function formatBenchmarkValue(value: number): string {
  if (value < 1) {
    return `${(value * 100).toFixed(0)}%`;
  }
  // Same one decimal as before, now with thousands separators.
  return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
