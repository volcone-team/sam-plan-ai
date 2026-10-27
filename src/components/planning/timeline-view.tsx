'use client';
import { formatDate } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { productService } from '@/services/product.service';
import type { Initiative, Product } from '@/types';
import { usePlanYears } from '@/hooks/use-plan-years';
import { PlanYearTabs } from '@/components/planning/plan-year-tabs';
import { horizonSpan } from '@/lib/initiatives/schedule';
import { horizonEnd, runDates } from '@/lib/planning/revenue-spread';
import { planService } from '@/services/plan.service';
import { REPEAT_FREQUENCY_LABELS, type RepeatFrequency } from '@/lib/intake-forecast';
import { daysInMonth, parseDateOnly, toDateOnly, type DateOnly } from '@/lib/plan-dates';

/**
 * An initiative's bar for one calendar year: launch -> revenue close (the
 * event date for older rows), clipped to the year. Null when the initiative
 * has no dates or does not touch the year.
 *
 * The timeline used to ignore the year: everything was placed by month alone,
 * so January 2027 work sat in "Q1" beside 2026 work, and an initiative with no
 * end ran to a hard-coded 31 Dec 2026.
 */
interface YearBar {
  start: DateOnly;
  end: DateOnly;
  /** Began in an earlier year. */
  continuesFrom: boolean;
  /** Runs on past this year (or has no end). */
  continuesTo: boolean;
  /** Recurring run dates inside this year (empty for other kinds). */
  runs: DateOnly[];
}

function barForYear(i: Initiative, year: number, planEnd: DateOnly | null): YearBar | null {
  const base = horizonSpan(i);
  if (!base) return null;
  // A recurring initiative runs on past its first event: the bar reaches its last run.
  const runs = runDates(i, planEnd);
  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
  const span = lastRun && base.end !== null && lastRun > base.end ? { ...base, end: lastRun } : base;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (span.start > yearEnd) return null;
  if (span.end !== null && span.end < yearStart) return null;
  return {
    start: span.start < yearStart ? yearStart : span.start,
    end: span.end === null || span.end > yearEnd ? yearEnd : span.end,
    continuesFrom: span.start < yearStart,
    continuesTo: span.end === null || span.end > yearEnd,
    runs: runs.filter(d => d >= yearStart && d <= yearEnd),
  };
}

/** 0–12 across the year. Start of day for a start, end of day for an end. */
function position(d: DateOnly, edge: 'start' | 'end'): number {
  const month = Number(d.slice(5, 7));
  const dayOfMonth = Number(d.slice(8, 10));
  const days = daysInMonth(Number(d.slice(0, 4)), month);
  return month - 1 + (edge === 'start' ? dayOfMonth - 1 : dayOfMonth) / days;
}


const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  launched: 'bg-emerald-500',
  completed: 'bg-purple-500',
  paused: 'bg-amber-500',
  retired: 'bg-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In Progress',
  launched: 'Launched',
  completed: 'Completed',
  paused: 'Paused',
  retired: 'Retired',
};

interface QuarterGroup {
  label: string;
  quarter: number;
  initiatives: { initiative: Initiative; bar: YearBar }[];
}

const QUARTER_RANGES = ['Jan – Mar', 'Apr – Jun', 'Jul – Sep', 'Oct – Dec'];

export function TimelineView() {
  const companyId = useCompanyId() || "";
  // Same year tabs, and the same remembered year, as Monthly and Quarterly.
  const { selectedYear: YEAR, setSelectedYear, years: planYears } = usePlanYears(companyId);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('all');
  /** Last day of the plan horizon; bounds recurring runs. */
  const [planEnd, setPlanEnd] = useState<DateOnly | null>(null);

  useEffect(() => {
    if (!companyId) return;
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [allInitiatives, allProducts] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          productService.getProductsByCompany(companyId),
        ]);

        setInitiatives(allInitiatives);
        setProducts(allProducts);
        const horizon = await planService.getPlanHorizon(companyId);
        setPlanEnd(horizonEnd(horizon?.planStartMonth, horizon?.horizonMonths));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load timeline data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [companyId]);

  const filteredInitiatives = useMemo(() => {
    if (selectedProduct === 'all') return initiatives;
    return initiatives.filter(i => i.productId === selectedProduct);
  }, [initiatives, selectedProduct]);

  const quarterGroups: QuarterGroup[] = useMemo(() => {
    const groups: QuarterGroup[] = QUARTER_RANGES.map((range, idx) => ({
      label: `Q${idx + 1} ${YEAR} (${range})`,
      quarter: idx + 1,
      initiatives: [],
    }));

    // Grouped by the quarter the bar starts in within this year; work that
    // began in an earlier year starts in Q1. Undated initiatives sit nowhere.
    filteredInitiatives.forEach(init => {
      const bar = barForYear(init, YEAR, planEnd);
      if (!bar) return;
      const quarter = Math.floor((Number(bar.start.slice(5, 7)) - 1) / 3);
      groups[quarter].initiatives.push({ initiative: init, bar });
    });

    groups.forEach(g => {
      g.initiatives.sort((a, b) => a.bar.start.localeCompare(b.bar.start));
    });

    return groups;
  }, [filteredInitiatives, YEAR, planEnd]);

  const yearCount = quarterGroups.reduce((n, g) => n + g.initiatives.length, 0);

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
      {/* Year tabs first: which year you are looking at governs everything below. */}
      <PlanYearTabs
        years={planYears}
        selectedYear={YEAR}
        onSelect={setSelectedYear}
        currentYear={new Date().getFullYear()}
      />
      {/* Product Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        <label htmlFor="product-filter" className="text-sm font-medium">
          Product:
        </label>
        <select
          id="product-filter"
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
          className="px-3 py-1.5 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
        >
          <option value="all">All Products</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-[hsl(var(--foreground-muted))]">
          {yearCount} initiative{yearCount !== 1 ? 's' : ''} in {YEAR}
        </span>
      </div>

      {/* Status Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded-sm ${STATUS_COLORS[key]}`} />
            <span className="text-[hsl(var(--foreground-muted))]">{label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-8 overflow-x-auto">
        {/* Month headers */}
        <div className="min-w-[800px]">
          <div className="flex">
            <div className="w-52 shrink-0 text-sm font-semibold">{YEAR}</div>
            <div className="flex-1 grid grid-cols-12 gap-0">
              {MONTH_LABELS.map(label => (
                <div
                  key={label}
                  className="text-[10px] font-medium text-[hsl(var(--foreground-muted))] text-center"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quarter Groups */}
        {quarterGroups.map(group => (
          <div key={group.quarter} className="min-w-[800px] space-y-3">
            <h4 className="text-sm font-semibold text-[hsl(var(--foreground-muted))] border-b border-border pb-2">
              {group.label}
            </h4>

            {group.initiatives.length === 0 ? (
              <p className="text-xs text-[hsl(var(--foreground-muted))] py-2 pl-2">
                No initiatives in this quarter.
              </p>
            ) : (
              <div className="space-y-2">
                {group.initiatives.map(({ initiative, bar }) => {
                  const startPos = position(bar.start, 'start');
                  const endPos = position(bar.end, 'end');

                  const leftPct = (startPos / 12) * 100;
                  const widthPct = Math.max(((endPos - startPos) / 12) * 100, 1);
                  const colorClass = STATUS_COLORS[initiative.status] || 'bg-slate-400';
                  const event = initiative.eventDate ? toDateOnly(initiative.eventDate) : '';
                  const eventInYear = event.startsWith(`${YEAR}-`);

                  return (
                    <div
                      key={initiative.id}
                      className="flex items-center group cursor-pointer"
                      onClick={() => router.push(`/initiatives/${initiative.id}`)}
                    >
                      <div className="w-52 shrink-0 pr-3">
                        <span
                          className="text-xs font-medium truncate block group-hover:text-[hsl(var(--primary))] transition-colors"
                          title={initiative.name}
                        >
                          {initiative.name.length > 32
                            ? initiative.name.slice(0, 32) + '…'
                            : initiative.name}
                        </span>
                        <span className="text-[10px] text-[hsl(var(--foreground-muted))] capitalize">
                          {initiative.status.replace('_', ' ')}
                          {initiative.kind === 'recurring' && initiative.repeatFrequency &&
                            ` · ${REPEAT_FREQUENCY_LABELS[initiative.repeatFrequency as RepeatFrequency] ?? initiative.repeatFrequency}`}
                          {bar.continuesFrom && ' · from previous year'}
                          {bar.continuesTo && ' · continues next year'}
                        </span>
                      </div>
                      <div className="flex-1 relative h-7 bg-[hsl(var(--muted))]/30 rounded">
                        {/* Month grid lines */}
                        <div className="absolute inset-0 grid grid-cols-12">
                          {Array.from({ length: 11 }).map((_, i) => (
                            <div key={i} className="border-r border-border/30" />
                          ))}
                        </div>
                        {/* Initiative bar */}
                        <div
                          className={`absolute top-1 bottom-1 ${colorClass} opacity-80 group-hover:opacity-100 transition-opacity ${
                            bar.continuesFrom ? 'rounded-r' : bar.continuesTo ? 'rounded-l' : 'rounded'
                          }`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`${formatDate(parseDateOnly(bar.start))} – ${bar.continuesTo ? 'continues' : formatDate(parseDateOnly(bar.end))}`}
                        />
                        {/* One tick per recurring run in this year */}
                        {bar.runs.map(run => (
                          <div
                            key={run}
                            className="absolute top-1.5 bottom-1.5 w-px bg-white/80"
                            style={{ left: `${(position(run, 'start') / 12) * 100}%` }}
                            title={`Run: ${formatDate(parseDateOnly(run))}`}
                          />
                        ))}
                        {/* Event date marker, only when the event is in this year */}
                        {eventInYear && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-gray-800/60"
                            style={{ left: `${(position(event, 'end') / 12) * 100}%` }}
                            title={`Event: ${formatDate(parseDateOnly(event))}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {yearCount === 0 && (
          <p className="text-sm text-[hsl(var(--foreground-muted))] text-center py-8">
            No initiatives in {YEAR} for the selected filter.
          </p>
        )}
      </div>
    </div>
  );
}
