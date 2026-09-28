import { describe, it, expect } from 'vitest';
import {
  rankTopPerformers,
  findPerformerByName,
  normalizeInitiativeName,
  clampPercent,
  progressPercent,
  type RankableInitiative,
  type RankableResult,
} from './top-performers';

const LAST_YEAR = 2025;

const initiatives: RankableInitiative[] = [
  { id: 'a', name: 'Spring Webinar' },
  { id: 'b', name: 'Black Friday Promo' },
  { id: 'c', name: 'Email Nurture' },
  { id: 'd', name: 'Podcast Tour' },
];

/** Results arrive as date-only strings parsed to Dates by result.service. */
const result = (
  initiativeId: string | null,
  weekStartDate: string,
  actualRevenue: number,
): RankableResult => ({
  initiativeId,
  weekStartDate: new Date(weekStartDate),
  actualRevenue,
});

describe('rankTopPerformers', () => {
  it('returns nothing when there are no results', () => {
    expect(rankTopPerformers(initiatives, [], { year: LAST_YEAR })).toEqual([]);
  });

  it('returns nothing when there are no initiatives', () => {
    const results = [result('a', '2025-03-03', 50_000)];
    expect(rankTopPerformers([], results, { year: LAST_YEAR })).toEqual([]);
  });

  it('sums a initiative\'s weekly results and ranks by revenue descending', () => {
    const results = [
      result('a', '2025-03-03', 40_000),
      result('a', '2025-03-10', 60_000),
      result('b', '2025-11-24', 75_000),
      result('c', '2025-06-02', 25_000),
    ];

    const ranked = rankTopPerformers(initiatives, results, { year: LAST_YEAR });

    expect(ranked.map(p => [p.rank, p.name, p.revenue])).toEqual([
      [1, 'Spring Webinar', 100_000],
      [2, 'Black Friday Promo', 75_000],
      [3, 'Email Nurture', 25_000],
    ]);
  });

  it('only counts results inside the requested calendar year', () => {
    const results = [
      result('a', '2025-01-01', 10_000),
      result('a', '2025-12-31', 10_000),
      result('a', '2024-12-31', 999_000),
      result('a', '2026-01-01', 999_000),
    ];

    const ranked = rankTopPerformers(initiatives, results, { year: LAST_YEAR });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].revenue).toBe(20_000);
  });

  it('excludes initiatives with zero or negative revenue', () => {
    const results = [
      result('a', '2025-03-03', 50_000),
      result('b', '2025-03-03', 0),
      result('c', '2025-03-03', 10_000),
      result('c', '2025-03-10', -10_000),
      result('d', '2025-03-03', -5_000),
    ];

    const ranked = rankTopPerformers(initiatives, results, { year: LAST_YEAR });

    expect(ranked.map(p => p.name)).toEqual(['Spring Webinar']);
  });

  it('ignores results that belong to no initiative or to an unknown one', () => {
    const results = [
      result(null, '2025-03-03', 90_000),
      result('does-not-exist', '2025-03-03', 90_000),
      result('a', '2025-03-03', 1_000),
    ];

    const ranked = rankTopPerformers(initiatives, results, { year: LAST_YEAR });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].initiativeId).toBe('a');
  });

  it('breaks ties deterministically by name and still numbers ranks sequentially', () => {
    const results = [
      result('a', '2025-03-03', 50_000),
      result('b', '2025-03-03', 50_000),
      result('c', '2025-03-03', 50_000),
    ];

    const ranked = rankTopPerformers(initiatives, results, { year: LAST_YEAR });

    expect(ranked.map(p => p.name)).toEqual([
      'Black Friday Promo',
      'Email Nurture',
      'Spring Webinar',
    ]);
    expect(ranked.map(p => p.rank)).toEqual([1, 2, 3]);
    // Tied revenue means every bar is full width.
    expect(ranked.map(p => p.barPercent)).toEqual([100, 100, 100]);
  });

  it('scales bars relative to the #1 performer', () => {
    const results = [
      result('a', '2025-03-03', 100_000),
      result('b', '2025-03-03', 50_000),
      result('c', '2025-03-03', 25_000),
    ];

    const ranked = rankTopPerformers(initiatives, results, { year: LAST_YEAR });

    expect(ranked.map(p => p.barPercent)).toEqual([100, 50, 25]);
  });

  it('caps the list at the requested limit, defaulting to three', () => {
    const results = initiatives.map((i, index) =>
      result(i.id, '2025-03-03', 10_000 * (index + 1)),
    );

    expect(rankTopPerformers(initiatives, results, { year: LAST_YEAR })).toHaveLength(3);
    expect(rankTopPerformers(initiatives, results, { year: LAST_YEAR, limit: 2 })).toHaveLength(2);
    expect(rankTopPerformers(initiatives, results, { year: LAST_YEAR, limit: 0 })).toEqual([]);
  });

  it('accepts date-only strings as well as Dates', () => {
    const ranked = rankTopPerformers(
      initiatives,
      [{ initiativeId: 'a', weekStartDate: '2025-07-07', actualRevenue: 12_000 }],
      { year: LAST_YEAR },
    );

    expect(ranked[0].revenue).toBe(12_000);
  });
});

describe('findPerformerByName', () => {
  const ranked = rankTopPerformers(
    initiatives,
    [
      result('a', '2025-03-03', 100_000),
      result('b', '2025-03-03', 50_000),
    ],
    { year: LAST_YEAR },
  );

  it('matches regardless of case and surrounding whitespace', () => {
    expect(findPerformerByName(ranked, '  spring WEBINAR ')?.rank).toBe(1);
    expect(findPerformerByName(ranked, 'BLACK FRIDAY PROMO')?.rank).toBe(2);
  });

  it('does not match a renamed initiative', () => {
    expect(findPerformerByName(ranked, 'Spring Webinar 2026')).toBeUndefined();
  });

  it('returns undefined for an empty name or an empty ranking', () => {
    expect(findPerformerByName(ranked, '   ')).toBeUndefined();
    expect(findPerformerByName([], 'Spring Webinar')).toBeUndefined();
  });
});

describe('normalizeInitiativeName', () => {
  it('trims and lowercases', () => {
    expect(normalizeInitiativeName('  Spring Webinar\n')).toBe('spring webinar');
  });
});

describe('clampPercent', () => {
  it('keeps values inside 0-100 and never returns NaN or Infinity', () => {
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(250)).toBe(100);
    expect(clampPercent(NaN)).toBe(0);
    expect(clampPercent(Infinity)).toBe(0);
  });
});

describe('progressPercent', () => {
  it('is zero when the target is zero or missing', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5_000, 0)).toBe(0);
    expect(progressPercent(5_000, -1)).toBe(0);
  });

  it('clamps overachievement to 100 and underwater actuals to 0', () => {
    expect(progressPercent(5_000, 10_000)).toBe(50);
    expect(progressPercent(20_000, 10_000)).toBe(100);
    expect(progressPercent(-1_000, 10_000)).toBe(0);
  });
});
