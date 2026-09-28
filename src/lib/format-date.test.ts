import { describe, it, expect } from 'vitest';
import { daysFromToday, formatRelativeDays } from './format-date';

/** Stand-in for "now" so the assertions don't move with the calendar. */
const NOW = new Date(2026, 2, 15, 9, 30); // 15 March 2026, local time

describe('daysFromToday', () => {
  it('counts whole days forward and backward from today', () => {
    expect(daysFromToday('2026-03-28', NOW)).toBe(13);
    expect(daysFromToday('2026-01-05', NOW)).toBe(-69);
    expect(daysFromToday('2026-03-15', NOW)).toBe(0);
  });

  it('reads date-only Dates the way the services produce them (UTC midnight)', () => {
    expect(daysFromToday(new Date('2026-03-28'), NOW)).toBe(13);
    expect(daysFromToday(new Date('2026-03-14'), NOW)).toBe(-1);
  });

  it('crosses year boundaries', () => {
    expect(daysFromToday('2025-12-31', new Date(2026, 0, 1, 23, 0))).toBe(-1);
  });

  it('returns null for unreadable input', () => {
    expect(daysFromToday('not a date', NOW)).toBeNull();
    expect(daysFromToday(new Date('nonsense'), NOW)).toBeNull();
  });
});

describe('formatRelativeDays', () => {
  it('labels future, past and today', () => {
    expect(formatRelativeDays('2026-03-28', NOW)).toBe('13d out');
    expect(formatRelativeDays('2026-01-05', NOW)).toBe('69d ago');
    expect(formatRelativeDays('2026-03-15', NOW)).toBe('today');
  });

  it('is empty for unreadable input rather than showing NaN', () => {
    expect(formatRelativeDays('', NOW)).toBe('');
    expect(formatRelativeDays('not a date', NOW)).toBe('');
  });
});
