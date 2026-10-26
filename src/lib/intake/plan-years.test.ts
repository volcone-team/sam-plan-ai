import { describe, expect, it } from 'vitest';
import {
  horizonYears,
  launchYear,
  planYearForInitiative,
  prorate,
  prorateTargets,
} from './plan-years';

describe('horizonYears', () => {
  it('a January start for 12 months is one year', () => {
    expect(horizonYears('2027-01-01', 12)).toEqual([{ year: 2027, months: 12 }]);
  });

  it('a November start for 12 months is 2 + 10', () => {
    expect(horizonYears('2026-11-01', 12)).toEqual([
      { year: 2026, months: 2 },
      { year: 2027, months: 10 },
    ]);
  });

  it('18 months from November spans three years', () => {
    expect(horizonYears('2026-11-01', 18)).toEqual([
      { year: 2026, months: 2 },
      { year: 2027, months: 12 },
      { year: 2028, months: 4 },
    ]);
  });

  it('a December start for 3 months is 1 + 2', () => {
    expect(horizonYears('2026-12-01', 3)).toEqual([
      { year: 2026, months: 1 },
      { year: 2027, months: 2 },
    ]);
  });

  it('reads only year and month', () => {
    expect(horizonYears('2026-11', 2)).toEqual([{ year: 2026, months: 2 }]);
    expect(horizonYears('2026-11-17T00:00:00Z', 2)).toEqual([{ year: 2026, months: 2 }]);
  });

  it('returns nothing for an unreadable start or empty horizon', () => {
    expect(horizonYears(null, 12)).toEqual([]);
    expect(horizonYears('garbage', 12)).toEqual([]);
    expect(horizonYears('2026-13-01', 12)).toEqual([]);
    expect(horizonYears('2026-11-01', 0)).toEqual([]);
    expect(horizonYears('2026-11-01', Number.NaN)).toEqual([]);
  });
});

describe('prorate / prorateTargets', () => {
  it('splits by months: Nov start, 12 months, $120,000 -> 20,000 + 100,000', () => {
    const years = horizonYears('2026-11-01', 12);
    expect([...prorate(120000, years)]).toEqual([[2026, 20000], [2027, 100000]]);
  });

  it('puts the rounding remainder on the last year so the parts sum to the total', () => {
    const years = horizonYears('2026-11-01', 12);
    const parts = prorate(123455, years);
    expect(parts.get(2026)).toBe(20576); // 123455 * 2/12 = 20575.83
    expect(parts.get(2027)).toBe(102879);
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBe(123455);
  });

  it('three years sum exactly', () => {
    const years = horizonYears('2026-11-01', 18);
    const parts = prorate(100001, years);
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBe(100001);
    expect(parts.get(2027)).toBe(Math.round((100001 * 12) / 18));
  });

  it('a single year gets the whole total', () => {
    expect([...prorate(80000.4, horizonYears('2027-01-01', 12))]).toEqual([[2027, 80000]]);
  });

  it('zero / negative / NaN totals give zeros', () => {
    const years = horizonYears('2026-12-01', 3);
    expect([...prorate(0, years).values()]).toEqual([0, 0]);
    expect([...prorate(-5, years).values()]).toEqual([0, 0]);
    expect([...prorate(Number.NaN, years).values()]).toEqual([0, 0]);
  });

  it('prorates baseline and stretch independently', () => {
    expect(
      prorateTargets({ baseline: 120000, stretch: 156000 }, horizonYears('2026-11-01', 12))
    ).toEqual([
      { year: 2026, months: 2, baseline: 20000, stretch: 26000 },
      { year: 2027, months: 10, baseline: 100000, stretch: 130000 },
    ]);
  });

  it('Dec start, 3 months', () => {
    expect(
      prorateTargets({ baseline: 30000, stretch: 39000 }, horizonYears('2026-12-01', 3))
    ).toEqual([
      { year: 2026, months: 1, baseline: 10000, stretch: 13000 },
      { year: 2027, months: 2, baseline: 20000, stretch: 26000 },
    ]);
  });
});

describe('launchYear', () => {
  it('prefers the activation date', () => {
    expect(launchYear('2026-10-21', '2027-01-15')).toBe(2026);
  });

  it('falls back to the event date', () => {
    expect(launchYear(null, '2027-03-01')).toBe(2027);
    expect(launchYear('', '2027-03-01')).toBe(2027);
  });

  it('is null when undated', () => {
    expect(launchYear(null, null)).toBeNull();
    expect(launchYear(undefined, 'nope')).toBeNull();
  });

  it('does not let a timezone move 1 January', () => {
    expect(launchYear('2027-01-01', null)).toBe(2027);
    expect(launchYear(new Date(Date.UTC(2027, 0, 1)), null)).toBe(2027);
  });
});

describe('planYearForInitiative', () => {
  it('uses the activation year over the passed plan', () => {
    expect(planYearForInitiative({ activationDate: '2026-10-21', eventDate: '2026-12-30' }, 2028)).toBe(2026);
  });

  it('uses the event year when there is no activation date', () => {
    expect(planYearForInitiative({ activationDate: null, eventDate: '2027-02-01' }, 2026)).toBe(2027);
  });

  it('keeps the passed plan year when undated', () => {
    expect(planYearForInitiative({ activationDate: null, eventDate: null }, 2028)).toBe(2028);
    expect(planYearForInitiative({}, 2027)).toBe(2027);
  });

  it('a date in the passed year changes nothing', () => {
    expect(planYearForInitiative({ activationDate: '2027-05-01', eventDate: null }, 2027)).toBe(2027);
  });
});
