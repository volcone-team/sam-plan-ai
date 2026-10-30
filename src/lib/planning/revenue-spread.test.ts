import { describe, it, expect } from 'vitest';
import { horizonEnd, monthShares, perRun, runDates } from './revenue-spread';
import { monthBuckets, quarterBuckets, sumBuckets } from './period-totals';
import { scaleToFittingRuns } from '@/lib/intake/build-forecast';

const scen = (better: number) => ({ good: better * 0.7, better, best: better * 1.3 });

describe('horizonEnd', () => {
  it('is the last day of the horizon', () => {
    expect(horizonEnd('2026-11-01', 12)).toBe('2027-10-31');
    expect(horizonEnd('2026-01', 3)).toBe('2026-03-31');
  });
  it('is null without a usable horizon', () => {
    expect(horizonEnd(null, 12)).toBeNull();
    expect(horizonEnd('2026-11-01', 0)).toBeNull();
  });
});

describe('runDates', () => {
  it('steps a monthly initiative from its first event to the plan end', () => {
    const i = { kind: 'recurring', repeatFrequency: 'monthly', activationDate: '2027-01-24', eventDate: '2027-02-28' };
    const runs = runDates(i, '2027-10-31');
    // Feb 28 then the 28th of each month through Oct: 9 runs.
    expect(runs).toHaveLength(9);
    expect(runs[0]).toBe('2027-02-28');
    expect(runs[runs.length - 1]).toBe('2027-10-28');
  });

  it('steps a weekly initiative 7 days at a time across New Year', () => {
    const i = { kind: 'recurring', repeatFrequency: 'weekly', activationDate: '2026-12-01', eventDate: '2026-12-22' };
    const runs = runDates(i, '2027-01-12');
    expect(runs).toEqual(['2026-12-22', '2026-12-29', '2027-01-05', '2027-01-12']);
  });

  it('stops at the last occurrence', () => {
    const i = {
      kind: 'recurring', repeatFrequency: 'monthly', activationDate: '2027-01-01', eventDate: '2027-01-15',
      lastOccurrenceDate: '2027-03-20', categoryId: 'x',
    };
    expect(runDates(i, '2027-12-31')).toEqual(['2027-01-15', '2027-02-15', '2027-03-15']);
  });

  it('reads the last occurrence from attrs before migration 061', () => {
    const i = {
      kind: 'recurring', repeatFrequency: 'monthly', eventDate: '2027-01-15',
      attrs: { last_occurrence_date: '2027-02-28' }, categoryId: 'x',
    };
    expect(runDates(i, '2027-12-31')).toEqual(['2027-01-15', '2027-02-15']);
  });

  it('is NOT ended by the revenue (cart) close date (client, Oct 2026)', () => {
    const i = {
      kind: 'recurring', repeatFrequency: 'monthly', eventDate: '2027-01-15',
      revenueCloseDate: '2027-01-18', categoryId: 'x',
    };
    expect(runDates(i, '2027-12-31')).toHaveLength(12);
  });

  it('defaults to twelve months from the first run without a plan end', () => {
    const i = { kind: 'recurring', repeatFrequency: 'quarterly', activationDate: '2027-01-01', eventDate: '2027-02-01' };
    expect(runDates(i, null)).toEqual(['2027-02-01', '2027-05-01', '2027-08-01', '2027-11-01']);
  });

  it('keeps a first run that is already past the plan end', () => {
    const i = { kind: 'recurring', repeatFrequency: 'monthly', activationDate: '2027-11-01', eventDate: '2027-12-01' };
    expect(runDates(i, '2027-10-31')).toEqual(['2027-12-01']);
  });

  it('is empty for one-time work or a missing frequency', () => {
    expect(runDates({ kind: 'one-time', eventDate: '2027-01-01', activationDate: '2026-12-01' }, null)).toEqual([]);
    expect(runDates({ kind: 'recurring', repeatFrequency: null, eventDate: '2027-01-01', activationDate: '2026-12-01' }, null)).toEqual([]);
  });
});

describe('monthShares', () => {
  it('splits a weekly initiative by runs per month and adds back up', () => {
    // Rachel's weekly Live Webinar: $75,000 Better, first run 16 Feb 2027.
    const i = {
      kind: 'recurring', repeatFrequency: 'weekly', activationDate: '2027-01-12', eventDate: '2027-02-16',
      revenueScenarios: scen(75000),
    };
    const shares = monthShares(i, '2027-03-31');
    // Feb 16, 23 (2 runs) + Mar 2, 9, 16, 23, 30 (5 runs) = 7 runs.
    expect(shares.map((s) => [s.month, s.runs])).toEqual([[2, 2], [3, 5]]);
    expect(shares[0].dates).toEqual(['2027-02-16', '2027-02-23']);
    expect(shares[0].better).toBeCloseTo((75000 * 2) / 7);
    expect(shares.reduce((t, s) => t + s.better, 0)).toBeCloseTo(75000);
  });

  it('shows a quarterly initiative once a quarter', () => {
    const i = {
      kind: 'recurring', repeatFrequency: 'quarterly', activationDate: '2027-01-01', eventDate: '2027-01-15',
      revenueScenarios: scen(4000),
    };
    expect(monthShares(i, '2027-12-31').map((s) => s.month)).toEqual([1, 4, 7, 10]);
  });

  it('spreads ongoing work evenly over its active months', () => {
    const i = { kind: 'evergreen', activationDate: '2026-11-05', revenueScenarios: scen(1200) };
    const shares = monthShares(i, '2027-10-31');
    expect(shares).toHaveLength(12);
    expect(shares[0]).toMatchObject({ year: 2026, month: 11 });
    expect(shares.every((s) => Math.abs(s.better - 100) < 1e-9)).toBe(true);
  });

  it('keeps one-time work in its event month', () => {
    const i = { kind: 'one-time', activationDate: '2026-10-27', eventDate: '2026-11-26', revenueScenarios: scen(1500) };
    expect(monthShares(i, null)).toEqual([{ year: 2026, month: 11, good: 1050, better: 1500, best: 1950, runs: 0, dates: ['2026-11-26'] }]);
  });
});

describe('perRun', () => {
  it('divides the total by the runs inside the plan', () => {
    const i = {
      kind: 'recurring', repeatFrequency: 'monthly', activationDate: '2027-01-24', eventDate: '2027-02-28',
      revenueScenarios: scen(432000),
    };
    expect(perRun(i, '2027-10-31')).toMatchObject({ better: 48000, runs: 9 });
  });
  it('is null for non-recurring work', () => {
    expect(perRun({ kind: 'one-time', eventDate: '2027-01-01', activationDate: '2026-12-01' }, null)).toBeNull();
  });
});

describe('monthBuckets with recurring work', () => {
  const weekly = {
    id: 'w', kind: 'recurring', repeatFrequency: 'weekly', activationDate: '2027-01-12', eventDate: '2027-02-16',
    revenueScenarios: scen(70000),
  };
  const once = { id: 'o', kind: 'one-time', activationDate: '2027-02-01', eventDate: '2027-03-10', revenueScenarios: scen(1000) };

  it('puts a share in every month with a run, and each month equals its entries', () => {
    const m = monthBuckets([weekly, once], 2027, '2027-03-31');
    expect(m[1].entries.map((e) => e.initiative.id)).toEqual(['w']);
    expect(m[2].entries.map((e) => e.initiative.id)).toEqual(['w', 'o']);
    for (const b of m) expect(b.better).toBeCloseTo(b.entries.reduce((t, e) => t + e.better, 0));
  });

  it('counts a recurring initiative once in the quarter and the year', () => {
    const m = monthBuckets([weekly, once], 2027, '2027-03-31');
    const q1 = quarterBuckets(m)[0];
    expect(q1.initiatives).toHaveLength(2);
    expect(q1.entries.find((e) => e.initiative.id === 'w')).toMatchObject({ runs: 7 });
    // The quarter lists the runs that fall in it, not the first event alone.
    expect(q1.entries.find((e) => e.initiative.id === 'w')!.dates).toHaveLength(7);
    expect(q1.better).toBeCloseTo(71000);
    expect(sumBuckets(m).initiatives).toHaveLength(2);
  });
});

describe('scaleToFittingRuns', () => {
  it('keeps the per-run figure and counts only the runs that fit', () => {
    // $36,000 a run x 12 planned; only 9 fit -> $324,000.
    expect(scaleToFittingRuns({ good: 302400, better: 432000, best: 561600 }, 12, 9)).toEqual({
      good: 226800, better: 324000, best: 421200,
    });
  });
  it('never scales up and ignores a zero plan', () => {
    const r = { good: 70, better: 100, best: 130 };
    expect(scaleToFittingRuns(r, 12, 14)).toBe(r);
    expect(scaleToFittingRuns(r, 0, 3)).toBe(r);
  });
});
