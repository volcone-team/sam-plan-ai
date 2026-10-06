'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Info } from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { resultService } from '@/services/result.service';
import { formatMoney } from '@/lib/format-money';

/**
 * "Where you are" - actual revenue against where the plan says you should be.
 *
 * Extracted from Year-at-a-Glance so the daily and weekly views show the same
 * three numbers rather than each computing their own. "Expected" is driven by
 * WHEN initiatives are scheduled: an initiative contributes its `better`
 * projection once its activation date has passed.
 */

// Full comma-separated figures — see lib/format-money. These cards report how
// far ahead or behind pace a company is, so the exact figure is the point.
const formatCurrency = formatMoney;

export interface PeriodStat {
  actual: number;
  expected: number;
}

export function PaceCard({
  label,
  actual,
  expected,
}: {
  label: string;
  actual: number;
  expected: number;
}) {
  const nothingScheduled = expected <= 0;
  const pct = nothingScheduled ? 0 : Math.round((actual / expected) * 100);
  const delta = actual - expected;
  const behind = delta < 0;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.4)] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight">{formatCurrency(actual)}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-[hsl(var(--foreground-muted))]">
        Expected: {formatCurrency(expected)}
        <span title="Based on the initiatives scheduled to have launched by now.">
          <Info className="h-3 w-3 text-[hsl(var(--foreground-subtle))]" />
        </span>
      </p>
      <div className="mt-3 border-t border-border" />
      <p className="mt-3 flex items-start gap-1.5 text-sm">
        {nothingScheduled ? (
          <>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span className="text-[hsl(var(--foreground-muted))]">
              No initiatives scheduled in this period yet.
            </span>
          </>
        ) : (
          <>
            <Clock
              className={'mt-0.5 h-4 w-4 shrink-0 ' + (behind ? 'text-amber-500' : 'text-emerald-500')}
            />
            <span className="text-[hsl(var(--foreground-muted))]">
              {pct}% of pace · {behind ? 'behind by' : 'ahead by'} {formatCurrency(Math.abs(delta))}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Loads and renders the month/quarter/year-to-date trio for a company.
 *
 * `asOf` lets the caller anchor the periods to the date being viewed rather than
 * always to today, so browsing a past day shows that day's pace.
 */
export function PaceCards({ companyId, asOf }: { companyId: string; asOf?: Date }) {
  const [stats, setStats] = useState<{ mtd: PeriodStat; qtd: PeriodStat; ytd: PeriodStat } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const now = asOf ?? new Date();
        const year = now.getFullYear();
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year, 11, 31);
        const monthStart = new Date(year, now.getMonth(), 1);
        const quarterStart = new Date(year, Math.floor(now.getMonth() / 3) * 3, 1);
        const cutoff = year === new Date().getFullYear() ? now : yearEnd;

        const [initiatives, results] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          resultService.getResultsByDateRange(yearStart, yearEnd, companyId),
        ]);
        if (cancelled) return;

        const sumActual = (from: Date) =>
          results
            .filter((r) => {
              const d = new Date(r.weekStartDate);
              return d >= from && d <= cutoff;
            })
            .reduce((sum, r) => sum + (r.actualRevenue || 0), 0);

        const sumExpected = (from: Date) =>
          initiatives
            .filter((i) => {
              const d = new Date(i.activationDate);
              return d >= from && d <= cutoff;
            })
            .reduce((sum, i) => sum + (i.revenueScenarios?.better || 0), 0);

        setStats({
          mtd: { actual: sumActual(monthStart), expected: sumExpected(monthStart) },
          qtd: { actual: sumActual(quarterStart), expected: sumExpected(quarterStart) },
          ytd: { actual: sumActual(yearStart), expected: sumExpected(yearStart) },
        });
      } catch (err) {
        console.error('[PaceCards] load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, asOf]);

  if (!stats) return null;

  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
        Where you are
      </p>
      <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
        Where you should be by now based on when your initiatives are scheduled.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PaceCard label="Month-to-date" actual={stats.mtd.actual} expected={stats.mtd.expected} />
        <PaceCard label="Quarter-to-date" actual={stats.qtd.actual} expected={stats.qtd.expected} />
        <PaceCard label="Year-to-date" actual={stats.ytd.actual} expected={stats.ytd.expected} />
      </div>
    </section>
  );
}
