'use client';

import { useEffect, useState } from 'react';
import { Activity, Calculator, PenLine } from 'lucide-react';
import type { Initiative } from '@/types';
import type { InitiativeType, BenchmarkScenario } from '@/types/initiative-type.types';
import { resultService } from '@/services/result.service';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';
import {
  formatMetricValue,
  metricGroupsOf,
  summariseMetrics,
  type MetricsSummary,
} from '@/lib/metrics/result-metrics';
import type { MetricKind } from '@/lib/metrics/dictionary';
import { formatMoney } from '@/lib/format-money';

export interface InitiativeMetricsProps {
  initiative: Initiative;
  initiativeType: InitiativeType | null;
}

/** One wb_benchmarks row for the initiative's library key. */
interface WorkbookBenchmark {
  metric: string;
  conservative: number | null;
  moderate: number | null;
  aggressive: number | null;
  unit: string | null;
  isPlaceholder: boolean;
}

/**
 * Conversion Metrics tab.
 *
 * Lists EVERY metric the initiative tracks — its metric set, frozen when it
 * was created (migration 040) — with the value so far from its weekly
 * results, and whether each one is entered or calculated (with the formula).
 * Below that, the workbook's benchmark ranges for the initiative, when the
 * workbook has any.
 *
 * It used to read only `initiative_types.benchmarks`, which is empty for
 * every type in use, so the tab showed nothing. Initiatives without a metric
 * set (older rows) keep that original view.
 */
export function InitiativeMetrics({ initiative, initiativeType }: InitiativeMetricsProps) {
  const [results, setResults] = useState<Awaited<ReturnType<typeof resultService.getResultsByInitiative>>>([]);
  const [benchmarks, setBenchmarks] = useState<WorkbookBenchmark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resultData, bench] = await Promise.all([
          resultService.getResultsByInitiative(initiative.id),
          loadWorkbookBenchmarks(initiative.libraryKey ?? null),
        ]);
        if (cancelled) return;
        setResults(resultData);
        setBenchmarks(bench);
      } catch {
        // Shown as "no values yet" rather than an error: the tab is read-only.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initiative.id, initiative.libraryKey]);

  const set = initiative.metricSet ?? null;
  if (!set) return <LegacyMetrics initiative={initiative} initiativeType={initiativeType} results={results} loading={loading} />;

  const groups = metricGroupsOf(set);
  const summary: MetricsSummary = summariseMetrics(set, results);
  const showGroupHeadings = groups.length >= 2;
  const weeksRecorded = results.length;

  return (
    <div className="space-y-8">
      <section aria-labelledby="metrics-heading" className="space-y-4">
        <div>
          <h2 id="metrics-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Activity className="h-5 w-5 text-[hsl(var(--primary))]" />
            Conversion Metrics
          </h2>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
            Everything this initiative tracks.{' '}
            {loading
              ? 'Loading your results…'
              : weeksRecorded === 0
                ? 'No results recorded yet: enter them on the Results tab or in the Weekly Planner.'
                : `Values so far, from ${weeksRecorded} week${weeksRecorded !== 1 ? 's' : ''} of results.`}
          </p>
        </div>

        {groups.map((g, gi) => (
          <div key={`${g.label ?? 'general'}-${gi}`} className="space-y-3">
            {showGroupHeadings && (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                {g.label ?? 'General'}
              </h3>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.fields.map(f => (
                <MetricTile
                  key={f.id}
                  label={f.label}
                  value={loading ? '…' : formatMetricValue(f.kind, f.unit, summary.entered[f.id])}
                  detail={
                    summary.weeks[f.id]
                      ? `Entered · ${summary.weeks[f.id]} week${summary.weeks[f.id] !== 1 ? 's' : ''} recorded`
                      : 'Entered weekly'
                  }
                  optional={f.optional}
                  derived={false}
                />
              ))}
              {g.derived.map(d => (
                <MetricTile
                  key={d.id}
                  label={d.label}
                  value={loading ? '…' : formatMetricValue(d.kind, d.unit, summary.derived[d.id])}
                  detail={`Calculated: ${d.formulaText}`}
                  optional={false}
                  derived
                />
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          Totals across all weeks. Rates are recalculated from the totals; follower and list counts show the latest week.
        </p>
      </section>

      {benchmarks.length > 0 && <WorkbookBenchmarks rows={benchmarks} />}
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  optional,
  derived,
}: {
  label: string;
  value: string;
  detail: string;
  optional: boolean;
  derived: boolean;
}) {
  const Icon = derived ? Calculator : PenLine;
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-[hsl(var(--foreground-muted))]">{label}</h4>
        {optional && (
          <span className="rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
            Optional
          </span>
        )}
      </div>
      <p className="mt-2 text-xl font-bold text-[hsl(var(--foreground))]">{value}</p>
      <p className="mt-1 flex items-start gap-1 text-xs text-[hsl(var(--foreground-muted))]">
        <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {detail}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Workbook benchmark ranges (wb_benchmarks)
 * ───────────────────────────────────────────────── */

async function loadWorkbookBenchmarks(libraryKey: string | null): Promise<WorkbookBenchmark[]> {
  if (!libraryKey || !isSupabaseConfigured()) return [];
  // wb_benchmarks is readable by any signed-in user (migration 018).
  const { data, error } = await getSupabase()
    .from('wb_benchmarks')
    .select('metric, conservative, moderate, aggressive, unit, is_placeholder')
    .eq('initiative_key', libraryKey);
  if (error || !data) return [];
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  return data.map(r => ({
    metric: String(r.metric),
    conservative: num(r.conservative),
    moderate: num(r.moderate),
    aggressive: num(r.aggressive),
    unit: typeof r.unit === 'string' ? r.unit : null,
    isPlaceholder: r.is_placeholder === true,
  }));
}

/** A benchmark figure: rates are stored as fractions (0.25 = 25%). */
function formatBenchmark(value: number | null, unit: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === '$') return formatMoney(value);
  if (unit === '%' || (unit === null && value > 0 && value < 1)) {
    return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function WorkbookBenchmarks({ rows }: { rows: WorkbookBenchmark[] }) {
  const anyPlaceholder = rows.some(r => r.isPlaceholder);
  return (
    <section aria-labelledby="benchmark-ranges-heading" className="space-y-3">
      <div>
        <h2 id="benchmark-ranges-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Benchmark Ranges
        </h2>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Typical conversion rates for this kind of initiative: conservative, moderate and aggressive.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(r => (
          <div key={r.metric} className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
            <h4 className="mb-3 text-xs font-semibold text-[hsl(var(--foreground))]">
              {r.metric}
              {r.isPlaceholder && <span className="ml-1 font-normal text-[hsl(var(--foreground-muted))]">(estimate)</span>}
            </h4>
            <div className="flex items-center justify-between gap-2">
              {([
                ['Cons.', r.conservative, 'text-[hsl(var(--foreground-muted))]'],
                ['Mod.', r.moderate, 'font-bold text-[hsl(var(--foreground))]'],
                ['Aggr.', r.aggressive, 'text-[hsl(var(--primary))]'],
              ] as const).map(([label, value, cls], i) => (
                <div key={label} className={`flex-1 text-center ${i === 1 ? 'border-l border-r border-border px-2' : ''}`}>
                  <p className="text-[10px] uppercase text-[hsl(var(--foreground-muted))]">{label}</p>
                  <p className={`text-sm ${cls}`}>{formatBenchmark(value, r.unit)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {anyPlaceholder && (
        <p className="text-xs text-[hsl(var(--foreground-muted))]">Figures marked (estimate) are still being verified.</p>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────
 * Older initiatives with no metric set: the original view
 * ───────────────────────────────────────────────── */

function LegacyMetrics({
  initiative,
  initiativeType,
  results,
  loading,
}: {
  initiative: Initiative;
  initiativeType: InitiativeType | null;
  results: Awaited<ReturnType<typeof resultService.getResultsByInitiative>>;
  loading: boolean;
}) {
  // Every number any result recorded, summed by key.
  const aggregated: Record<string, number> = {};
  for (const r of results) {
    const metrics = r.metrics as Record<string, unknown> | undefined;
    if (!metrics) continue;
    for (const [key, val] of Object.entries(metrics)) {
      if (typeof val === 'number') aggregated[key] = (aggregated[key] || 0) + val;
    }
  }
  const benchmarks = initiativeType?.benchmarks ?? {};
  const benchmarkKeys = Object.keys(benchmarks);
  const recordedKeys = Object.keys(aggregated).filter(k => !(k in benchmarks));
  const pretty = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  if (benchmarkKeys.length === 0 && recordedKeys.length === 0 && !initiative.trafficInput) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          {loading ? 'Loading…' : 'This initiative has no conversion metrics set up yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
          <Activity className="h-5 w-5 text-[hsl(var(--primary))]" />
          Conversion Metrics
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {initiative.trafficInput ? (
            <MetricTile
              label="Expected Traffic / Registrants"
              value={(initiative.trafficInput).toLocaleString('en-US')}
              detail={`Projected · actual ${formatPlain('count', aggregated.registrants ?? aggregated.traffic ?? null)}`}
              optional={false}
              derived={false}
            />
          ) : null}
          {benchmarkKeys.map(key => {
            const s = benchmarks[key] as BenchmarkScenario;
            const isRate = s.moderate < 1;
            return (
              <MetricTile
                key={key}
                label={pretty(key)}
                value={formatPlain(isRate ? 'rate' : 'count', aggregated[key] !== undefined ? (isRate && aggregated[key] < 1 ? aggregated[key] * 100 : aggregated[key]) : null)}
                detail={`Benchmark ${formatPlain(isRate ? 'rate' : 'count', isRate ? s.moderate * 100 : s.moderate)} (moderate)`}
                optional={false}
                derived={false}
              />
            );
          })}
          {recordedKeys.map(key => (
            <MetricTile
              key={key}
              label={pretty(key)}
              value={formatPlain('count', aggregated[key])}
              detail="Total recorded"
              optional={false}
              derived={false}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function formatPlain(kind: MetricKind, value: number | null): string {
  return formatMetricValue(kind, undefined, value);
}
