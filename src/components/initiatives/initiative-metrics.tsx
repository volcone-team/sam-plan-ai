'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import type { Initiative } from '@/types';
import type { InitiativeType, BenchmarkScenario } from '@/types/initiative-type.types';
import { resultService } from '@/services/result.service';

export interface InitiativeMetricsProps {
  initiative: Initiative;
  initiativeType: InitiativeType | null;
}

interface MetricData {
  label: string;
  projected: number;
  actual: number | null;
  format: 'number' | 'percent';
}

/**
 * Conversion Metrics tab.
 * Displays projected vs actual for registrants, show rate, offer conversion.
 * Uses initiative type benchmarks and trafficInput for projections.
 */
export function InitiativeMetrics({ initiative, initiativeType }: InitiativeMetricsProps) {
  const [aggregatedMetrics, setAggregatedMetrics] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadResults = async () => {
      try {
        const resultData = await resultService.getResultsByInitiative(initiative.id);
        // Aggregate ALL metrics from results dynamically
        const aggregated: Record<string, number> = {};
        for (const r of resultData) {
          const metrics = r.metrics as Record<string, number> | undefined;
          if (metrics) {
            for (const [key, val] of Object.entries(metrics)) {
              if (typeof val === 'number') {
                aggregated[key] = (aggregated[key] || 0) + val;
              }
            }
          }
        }
        setAggregatedMetrics(aggregated);
      } catch {
        // Silently handle
      } finally {
        setLoading(false);
      }
    };
    loadResults();
  }, [initiative.id]);

  if (!initiativeType) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          No initiative type data available for metrics.
        </p>
      </div>
    );
  }

  const trafficInput = initiative.trafficInput || 0;
  const benchmarks = initiativeType.benchmarks;

  // Build metrics dynamically from ALL benchmark keys
  // Each benchmark key (e.g., "registration_rate") maps to the same key in results metrics
  const metrics: MetricData[] = [];

  // Traffic input as first metric if available
  if (trafficInput > 0) {
    metrics.push({
      label: 'Expected Traffic / Registrants',
      projected: trafficInput,
      actual: aggregatedMetrics['registrants'] || aggregatedMetrics['traffic'] || null,
      format: 'number',
    });
  }

  // All benchmark metrics
  Object.entries(benchmarks).forEach(([key, scenario]) => {
    const actualValue = aggregatedMetrics[key];
    metrics.push({
      label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      projected: scenario.moderate < 1 ? scenario.moderate * 100 : scenario.moderate,
      actual: actualValue !== undefined ? (actualValue < 1 ? actualValue * 100 : actualValue) : null,
      format: scenario.moderate < 1 ? 'percent' : 'number',
    });
  });

  return (
    <div className="space-y-8">
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
          <Activity className="h-5 w-5 text-[hsl(var(--primary))]" />
          Conversion Metrics
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {metrics.map(metric => (
            <MetricCard key={metric.label} metric={metric} loading={loading} />
          ))}
        </div>
      </section>

      {/* Benchmark Ranges */}
      {Object.keys(benchmarks).length > 0 && (
        <section aria-labelledby="benchmark-ranges-heading">
          <h2 id="benchmark-ranges-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Benchmark Ranges
          </h2>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
            Industry benchmarks for {initiativeType.name} initiatives
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(benchmarks).map(([key, scenario]) => (
              <BenchmarkRangeCard
                key={key}
                label={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                scenario={scenario}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MetricCard({ metric, loading }: { metric: MetricData; loading: boolean }) {
  const { label, projected, actual, format } = metric;

  const formatValue = (val: number) => {
    if (format === 'percent') return `${val.toFixed(1)}%`;
    return val.toLocaleString();
  };

  const progressPercent = actual !== null && projected > 0
    ? Math.min((actual / projected) * 100, 100)
    : 0;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
      <h3 className="text-sm font-medium text-[hsl(var(--foreground-muted))]">{label}</h3>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Projected</p>
          <p className="text-lg font-bold text-[hsl(var(--foreground))]">{formatValue(projected)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Actual</p>
          <p className="text-lg font-bold text-[hsl(var(--primary))]">
            {loading ? '...' : actual !== null ? formatValue(actual) : '—'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {actual !== null && (
        <div className="mt-3">
          <div className="h-2 w-full rounded-full bg-[hsl(var(--background-muted))]">
            <div
              className="h-full rounded-full bg-[hsl(var(--primary))] transition-all"
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={actual}
              aria-valuemin={0}
              aria-valuemax={projected}
              aria-label={`${label} progress`}
            />
          </div>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
            {progressPercent.toFixed(0)}% of projected
          </p>
        </div>
      )}
    </div>
  );
}

function BenchmarkRangeCard({ label, scenario }: { label: string; scenario: BenchmarkScenario }) {
  const formatVal = (v: number) => (v < 1 ? `${(v * 100).toFixed(0)}%` : v.toFixed(1));

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <h4 className="text-xs font-semibold text-[hsl(var(--foreground))] mb-3">{label}</h4>
      <div className="flex items-center justify-between gap-2">
        <div className="text-center flex-1">
          <p className="text-[10px] text-[hsl(var(--foreground-muted))] uppercase">Cons.</p>
          <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">{formatVal(scenario.conservative)}</p>
        </div>
        <div className="text-center flex-1 border-l border-r border-border px-2">
          <p className="text-[10px] text-[hsl(var(--foreground-muted))] uppercase">Mod.</p>
          <p className="text-sm font-bold text-[hsl(var(--foreground))]">{formatVal(scenario.moderate)}</p>
        </div>
        <div className="text-center flex-1">
          <p className="text-[10px] text-[hsl(var(--foreground-muted))] uppercase">Aggr.</p>
          <p className="text-sm font-medium text-[hsl(var(--primary))]">{formatVal(scenario.aggressive)}</p>
        </div>
      </div>
    </div>
  );
}
