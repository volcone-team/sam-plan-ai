'use client';
import { formatDateShort } from '@/lib/format-date';
import { formatMoney } from '@/lib/format-money';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { resultService } from '@/services/result.service';
import { initiativeService } from '@/services/initiative.service';
import type { Initiative } from '@/types';
import { usePlanYears } from '@/hooks/use-plan-years';
import { REPEAT_FREQUENCY_LABELS, type RepeatFrequency } from '@/lib/intake-forecast';
import { parseDateOnly, toDateOnly } from '@/lib/plan-dates';
import { monthBuckets, sumBuckets, type BucketEntry } from '@/lib/planning/period-totals';
import { loadPlanPeriod } from '@/lib/planning/load-period-targets';

// Year comes from the shared PlanYearProvider, not a module-level constant.
// The old `const YEAR = new Date().getFullYear()` was evaluated once when this
// chunk was parsed, which made a plan spanning into the next year unviewable.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Full comma-separated figures — see lib/format-money.
const formatCurrency = formatMoney;

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

interface MonthData {
  /** True when the month has a target or initiatives, so its figures are real. */
  planned: boolean;
  month: number;
  target: number;
  good: number;
  better: number;
  best: number;
  actual: number;
  variance: number;
  variancePercent: number | null;
  /** The initiatives with revenue in this month. */
  initiatives: Initiative[];
  /** Each of them with its share of this month (a recurring one counts every run here). */
  entries: BucketEntry<Initiative>[];
}

const STATUS_COLORS: Record<string, { dot: string; badge: string }> = {
  planned: { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700' },
  in_progress: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
  launched: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  completed: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  paused: { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700' },
  retired: { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-500' },
};

/** Variance of actual against the Better scenario, as before. */
function variances(actual: number, better: number) {
  return {
    variance: actual - better,
    variancePercent: better > 0 ? ((actual - better) / better) * 100 : null,
  };
}

export function MonthlySummaryTable() {
  const companyId = useCompanyId() || "";
  // Shared with Year-at-a-Glance: the plan year being viewed, which may be a
  // year the plan spans into rather than the current calendar year.
  const { selectedYear: YEAR } = usePlanYears(companyId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthsData, setMonthsData] = useState<MonthData[]>([]);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  // "Now" is a point in time: the current month of the current YEAR only.
  const now = new Date();
  const nowMonth = YEAR === now.getFullYear() ? now.getMonth() + 1 : null;

  useEffect(() => {
    if (!companyId) return;
    const loadAllMonths = async () => {
      try {
        setLoading(true);
        setError(null);

        /*
         * Figures come from the initiatives and the annual plan. They used to
         * come from the `projections` table, which the current intake never
         * writes, so every month read $0 above initiatives with real numbers.
         * Each initiative's revenue is counted once, in its event month (see
         * lib/planning/period-totals), so a month equals the rows under it.
         */
        const [initiatives, period, results] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          loadPlanPeriod(companyId, YEAR),
          resultService.getResultsByDateRange(
            new Date(YEAR, 0, 1),
            new Date(YEAR, 11, 31),
            companyId
          ),
        ]);

        const actualByMonth = Array.from({ length: 12 }, () => 0);
        for (const r of results) {
          const d = toDateOnly(r.weekStartDate);
          if (Number(d.slice(0, 4)) !== YEAR) continue;
          actualByMonth[Number(d.slice(5, 7)) - 1] += r.actualRevenue || 0;
        }

        const targets = period.monthTargets;
        const buckets = monthBuckets(initiatives, YEAR, period.planEnd);
        setMonthsData(
          buckets.map((b, idx) => {
            const actual = actualByMonth[idx];
            return {
              month: idx + 1,
              planned: b.initiatives.length > 0 || targets[idx] > 0,
              target: targets[idx],
              good: b.good,
              better: b.better,
              best: b.best,
              actual,
              ...variances(actual, b.better),
              initiatives: b.initiatives,
              entries: b.entries,
            };
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load summary data';
        setError(message);
        console.error('Error loading monthly summary:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAllMonths();
  }, [companyId, YEAR]);

  const toggleExpand = (month: number) => {
    setExpandedMonth(expandedMonth === month ? null : month);
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

  // Year totals: every initiative sits in exactly one month, so none is counted twice.
  const yearScenarios = sumBuckets(monthsData);
  const yearTarget = monthsData.reduce((sum, m) => sum + m.target, 0);
  const yearActual = monthsData.reduce((sum, m) => sum + m.actual, 0);
  const { variance: yearVariance, variancePercent: yearVariancePct } = variances(
    yearActual,
    yearScenarios.better
  );

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          All 12 months of {YEAR}. One-time revenue counts in its event month; recurring revenue is spread across its runs. Click a row to see its initiatives.
        </p>
        <div className="flex items-center gap-2 shrink-0 ml-4">
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
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[hsl(var(--muted))]/50">
              <th className="text-left py-3 px-4 font-medium text-[hsl(var(--foreground-muted))]">Month</th>
              <th className="text-right py-3 px-3 font-medium text-[hsl(var(--foreground-muted))]">Target</th>
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
            {monthsData.map((m) => (
              <MonthRow
                key={m.month}
                data={m}
                year={YEAR}
                isCurrent={m.month === nowMonth}
                isExpanded={expandedMonth === m.month}
                onToggle={() => toggleExpand(m.month)}
              />
            ))}
            {/* Year Total Row */}
            <tr className="bg-[hsl(var(--muted))]/30 font-semibold">
              <td className="py-3 px-4 text-[hsl(var(--foreground))]">{YEAR} TOTAL</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearTarget)}</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearScenarios.good)}</td>
              <td className="text-right py-3 px-3 font-bold text-[hsl(var(--foreground))]">{formatCurrency(yearScenarios.better)}</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearScenarios.best)}</td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{formatCurrency(yearActual)}</td>
              <td className={`text-right py-3 px-3 ${yearVariance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(yearVariance)}
              </td>
              <td className={`text-right py-3 px-3 ${yearVariancePct !== null && yearVariancePct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {yearVariancePct !== null ? formatPercent(yearVariancePct) : '—'}
              </td>
              <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{yearScenarios.initiatives.length}</td>
              <td className="text-center py-3 px-3">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


/* --- Month Row with expandable initiatives --- */

interface MonthRowProps {
  data: MonthData;
  year: number;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function MonthRow({ data, year, isCurrent, isExpanded, onToggle }: MonthRowProps) {
  const { month, planned, target, good, better, best, actual, variance, variancePercent, initiatives } = data;
  // A month is only "planned" when it actually has initiatives. Without that,
  // the year-level projection rollup filled in targets for every month - including
  // the months before a mid-year plan starts, which is misleading.
  const hasData = planned || actual > 0 || initiatives.length > 0;

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
            <span className={`font-medium text-[hsl(var(--foreground))] ${isCurrent ? 'font-bold underline' : ''}`}>
              {MONTH_NAMES[month - 1]} {year}
            </span>
            {isCurrent && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
                NOW
              </span>
            )}
          </div>
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(target) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(good) : '—'}
        </td>
        <td className="text-right py-3 px-3 font-bold text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(better) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(best) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">
          {hasData ? formatCurrency(actual) : '—'}
        </td>
        <td className={`text-right py-3 px-3 font-medium ${hasData ? (variance >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-[hsl(var(--foreground-muted))]'}`}>
          {hasData ? formatCurrency(variance) : '—'}
        </td>
        <td className={`text-right py-3 px-3 font-medium ${hasData && variancePercent !== null ? (variancePercent >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-[hsl(var(--foreground-muted))]'}`}>
          {hasData && variancePercent !== null ? formatPercent(variancePercent) : '—'}
        </td>
        <td className="text-right py-3 px-3 text-[hsl(var(--foreground))]">{initiatives.length}</td>
        <td className="text-center py-3 px-3">
          <MonthStatusBadge month={month} year={year} planned={planned} />
        </td>
      </tr>
      {/* Expanded initiative rows */}
      {isExpanded && initiatives.length > 0 && (
        <>
          {data.entries.map((entry) => (
            <InitiativeChildRow key={entry.initiative.id} entry={entry} />
          ))}
        </>
      )}
      {isExpanded && initiatives.length === 0 && (
        <tr>
          <td colSpan={10} className="py-3 px-4 pl-12 text-sm text-[hsl(var(--foreground-muted))] italic">
            No initiative revenue falls in this month.
          </td>
        </tr>
      )}
    </>
  );
}

/* --- Initiative child row --- */

interface InitiativeChildRowProps {
  /** The initiative and its share of this period. */
  entry: BucketEntry<Initiative>;
}

function InitiativeChildRow({ entry }: InitiativeChildRowProps) {
  const { initiative } = entry;
  const { status } = initiative;
  // A recurring initiative shows how often it runs and how many runs fall here.
  const frequency = initiative.kind === 'recurring' && initiative.repeatFrequency
    ? REPEAT_FREQUENCY_LABELS[initiative.repeatFrequency as RepeatFrequency] ?? initiative.repeatFrequency
    : null;
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.planned;
  const router = useRouter();

  /*
   * The dates that put revenue in THIS period: each run here, or the event
   * date. It used to print the initiative's first event, so a January row
   * read "10/27/2026". Ongoing work has no single date and shows none.
   */
  const dates = entry.dates.map((d) => formatDateShort(parseDateOnly(d)));
  const shownDates = dates.length > 3 ? `${dates.slice(0, 3).join(', ')} +${dates.length - 3} more` : dates.join(', ');
  const href = `/initiatives/${initiative.id}`;

  return (
    <tr
      className="cursor-pointer bg-[hsl(var(--muted))]/20 hover:bg-[hsl(var(--muted))]/40"
      onClick={() => router.push(href)}
    >
      <td className="py-2.5 px-4 pl-12">
        {/* Name on its own line so it is never squeezed out; the whole row opens the initiative. */}
        <div className="flex items-start gap-2 min-w-[220px]">
          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${statusColor.dot}`} />
          <div className="min-w-0">
            <Link
              href={href}
              title={initiative.name}
              className="block text-sm font-medium text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {initiative.name}
            </Link>
            <span className="block text-xs text-[hsl(var(--foreground-muted))]">
              <span className="capitalize">{initiative.kind.replace('-', ' ')}</span>
              {frequency && ` · ${frequency}`}
              {entry.runs > 0 && ` · ${entry.runs} occurrence${entry.runs !== 1 ? 's' : ''} here`}
              {shownDates && ` · ${shownDates}`}
            </span>
          </div>
        </div>
      </td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">—</td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">
        {formatCurrency(entry.good)}
      </td>
      <td className="text-right py-2.5 px-3 text-sm font-medium text-[hsl(var(--foreground))]">
        {formatCurrency(entry.better)}
      </td>
      <td className="text-right py-2.5 px-3 text-sm text-[hsl(var(--foreground-muted))]">
        {formatCurrency(entry.best)}
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

/* --- Month Status Badge --- */

function MonthStatusBadge({
  month,
  year,
  planned,
}: {
  month: number;
  year: number;
  planned: boolean;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // A month the plan does not cover has no status to report. It used to compare
  // month numbers only, so with a plan generated in September, August showed
  // "Complete" despite never having been planned - and every month before
  // September of a FUTURE year showed "Complete" as well, because the year was
  // ignored entirely.
  if (!planned) {
    return (
      <span className="text-xs font-medium text-[hsl(var(--foreground-subtle))]">
        Not planned
      </span>
    );
  }

  // Compare the actual point in time, not just the month number.
  const isPast = year < currentYear || (year === currentYear && month < currentMonth);
  const isCurrent = year === currentYear && month === currentMonth;

  if (isPast) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
        Complete
      </span>
    );
  }
  if (isCurrent) {
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
