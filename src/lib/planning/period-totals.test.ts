import { describe, it, expect } from 'vitest';
import {
  revenueMonth,
  monthBuckets,
  quarterBuckets,
  sumBuckets,
  coveredMonths,
  monthlyTargets,
  quarterTargets,
  weekTarget,
} from './period-totals';
import { parseDateOnly } from '@/lib/plan-dates';

const row = (
  id: string,
  activation: string | null,
  event: string | null,
  better: number,
  extra: Record<string, unknown> = {}
) => ({
  id,
  activationDate: activation ? parseDateOnly(activation) : null,
  eventDate: event ? parseDateOnly(event) : undefined,
  revenueScenarios: { good: better * 0.7, better, best: better * 1.3 },
  ...extra,
});

describe('revenueMonth', () => {
  it('uses the event month', () => {
    expect(revenueMonth(row('a', '2026-12-28', '2027-01-27', 1))).toEqual({ year: 2027, month: 1 });
  });

  it('falls back to the launch month when there is no event', () => {
    expect(revenueMonth(row('a', '2026-11-05', null, 1))).toEqual({ year: 2026, month: 11 });
  });

  it('is null when undated', () => {
    expect(revenueMonth(row('a', null, null, 1))).toBeNull();
  });
});

describe('monthBuckets / quarterBuckets', () => {
  // team@volcone-shaped data: Nov–Dec 2026 events plus a Dec -> Jan crossover.
  const list = [
    row('cross-sell', '2026-10-27', '2026-11-26', 1500),
    row('sponsor', '2026-11-01', '2026-12-01', 8800),
    row('referrals', '2026-12-28', '2027-01-27', 1500),
  ];

  it('puts each initiative in its event month only', () => {
    const m = monthBuckets(list, 2026);
    expect(m[10].better).toBe(1500);
    expect(m[11].better).toBe(8800);
    expect(m[9].better).toBe(0); // launched in October, event in November
    expect(m.flatMap((b) => b.initiatives).map((i) => i.id)).toEqual(['cross-sell', 'sponsor']);
  });

  it('moves a Dec -> Jan initiative into the next year', () => {
    const m = monthBuckets(list, 2027);
    expect(m[0].better).toBe(1500);
    expect(m[0].initiatives.map((i) => i.id)).toEqual(['referrals']);
  });

  it('makes a month equal the sum of its initiatives', () => {
    const m = monthBuckets(list, 2026);
    for (const b of m) {
      expect(b.better).toBe(b.initiatives.reduce((s, i) => s + i.revenueScenarios.better, 0));
    }
  });

  it('makes quarters the sum of their months and counts each initiative once', () => {
    const m = monthBuckets(list, 2026);
    const q = quarterBuckets(m);
    expect(q[3].better).toBe(10300);
    expect(q[3].initiatives).toHaveLength(2);
    expect(sumBuckets(q).initiatives).toHaveLength(2);
    expect(sumBuckets(q).better).toBe(sumBuckets(m).better);
  });

  it('treats missing or non-numeric revenue as zero', () => {
    const m = monthBuckets([{ id: 'x', eventDate: '2026-03-04', activationDate: '2026-03-01', revenueScenarios: null }], 2026);
    expect(m[2]).toMatchObject({ good: 0, better: 0, best: 0 });
    expect(m[2].initiatives).toHaveLength(1);
  });
});

describe('coveredMonths', () => {
  it('covers Nov–Dec of the start year and Jan–Oct of the next for Nov + 12', () => {
    expect(coveredMonths('2026-11-01', 12, 2026)).toEqual([11, 12]);
    expect(coveredMonths('2026-11-01', 12, 2027)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('covers nothing outside the horizon', () => {
    expect(coveredMonths('2026-11-01', 12, 2028)).toEqual([]);
  });

  it('covers the whole year without a horizon', () => {
    expect(coveredMonths(null, null, 2026)).toHaveLength(12);
  });

  it('handles a horizon longer than one following year', () => {
    expect(coveredMonths('2026-06-01', 24, 2027)).toHaveLength(12);
    expect(coveredMonths('2026-06-01', 24, 2028)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('monthlyTargets / quarterTargets', () => {
  it('spreads the year goal over the covered months and adds back up exactly', () => {
    // 2026 share of $123,455 over Nov 2026 + 12 months.
    const t = monthlyTargets(20576, [11, 12]);
    expect(t[10]).toBe(10288);
    expect(t[11]).toBe(10288);
    expect(t.reduce((s, v) => s + v, 0)).toBe(20576);
  });

  it('puts the rounding remainder in the last covered month', () => {
    const t = monthlyTargets(102879, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(t.reduce((s, v) => s + v, 0)).toBe(102879);
    expect(t[10]).toBe(0);
    expect(t[11]).toBe(0);
  });

  it('is all zero with no goal or no covered months', () => {
    expect(monthlyTargets(0, [1]).every((v) => v === 0)).toBe(true);
    expect(monthlyTargets(1000, []).every((v) => v === 0)).toBe(true);
  });

  it('sums quarters from months', () => {
    const t = monthlyTargets(1200, Array.from({ length: 12 }, (_, i) => i + 1));
    expect(quarterTargets(t)).toEqual([300, 300, 300, 300]);
  });
});

describe('weekTarget', () => {
  const flat = () => 3100; // $100 a day in a 31-day month

  it('is seven daily shares', () => {
    expect(weekTarget(new Date(2026, 11, 7), flat)).toBe(700);
  });

  it('takes from both months for a week that crosses a month end', () => {
    const targets: Record<string, number> = { '2026-11': 3000, '2026-12': 6200 };
    // Mon 30 Nov 2026 – Sun 6 Dec: 1 day of Nov ($100) + 6 days of Dec ($200 each).
    const got = weekTarget(new Date(2026, 10, 30), (y, m) => targets[`${y}-${String(m).padStart(2, '0')}`] ?? 0);
    expect(got).toBe(1300);
  });

  it('asks for the next year across New Year', () => {
    const asked = new Set<number>();
    weekTarget(new Date(2026, 11, 28), (y) => {
      asked.add(y);
      return 0;
    });
    expect([...asked].sort()).toEqual([2026, 2027]);
  });
});
