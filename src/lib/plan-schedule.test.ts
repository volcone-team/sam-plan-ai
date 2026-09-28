import { describe, it, expect } from 'vitest';
import { sequenceEventDates } from '@/lib/plan-schedule';
import { toDateOnly } from '@/lib/plan-dates';

const now = new Date(2026, 8, 27); // 27 Sep 2026
const run = (items: Parameters<typeof sequenceEventDates>[0]) =>
  sequenceEventDates(items, { now });

describe('sequenceEventDates', () => {
  it('never puts two launches on the same day', () => {
    const r = run([
      { desiredEvent: '2026-11-10', runwayDays: 7 },
      { desiredEvent: '2026-11-10', runwayDays: 7 },
      { desiredEvent: '2026-11-10', runwayDays: 7 },
    ]);
    const days = r.map(x => toDateOnly(x.eventDate));
    expect(new Set(days).size).toBe(3);
  });

  it('does not start prep before the previous launch', () => {
    const r = run([
      { desiredEvent: '2026-11-01', runwayDays: 14 },
      { desiredEvent: '2026-11-05', runwayDays: 14 },
    ]);
    // Second initiative's prep window must begin after the first launch.
    expect(toDateOnly(r[1].activationDate) > toDateOnly(r[0].eventDate)).toBe(true);
  });

  it('keeps every event in the future with its runway intact', () => {
    const r = run([
      { desiredEvent: '2026-09-28', runwayDays: 21 },
      { desiredEvent: '2026-09-29', runwayDays: 3 },
    ]);
    expect(toDateOnly(r[0].eventDate)).toBe('2026-10-18'); // 27 Sep + 21
    for (const x of r) {
      expect(toDateOnly(x.activationDate) >= '2026-09-27').toBe(true);
      expect(toDateOnly(x.eventDate) >= '2026-09-27').toBe(true);
    }
  });

  it('leaves a well-spaced plan untouched', () => {
    const r = run([
      { desiredEvent: '2026-11-10', runwayDays: 7 },
      { desiredEvent: '2027-02-10', runwayDays: 7 },
      { desiredEvent: '2027-05-10', runwayDays: 7 },
    ]);
    expect(r.map(x => toDateOnly(x.eventDate))).toEqual(['2026-11-10', '2027-02-10', '2027-05-10']);
    expect(r.every(x => !x.adjusted)).toBe(true);
  });

  it('preserves intended order even when input is unsorted', () => {
    const r = run([
      { desiredEvent: '2027-03-01', runwayDays: 5 },
      { desiredEvent: '2026-10-20', runwayDays: 5 },
    ]);
    // Results map back to input positions; the earlier desired date stays earlier.
    expect(toDateOnly(r[1].eventDate) < toDateOnly(r[0].eventDate)).toBe(true);
  });

  it('evergreen work neither blocks nor is blocked', () => {
    const r = run([
      { desiredEvent: '2026-11-10', runwayDays: 0, exclusive: false },
      { desiredEvent: '2026-11-10', runwayDays: 7 },
      { desiredEvent: '2026-11-10', runwayDays: 7 },
    ]);
    // The two launches still differ; evergreen may share a date with them.
    expect(toDateOnly(r[1].eventDate)).not.toBe(toDateOnly(r[2].eventDate));
    expect(toDateOnly(r[0].eventDate)).toBe('2026-11-10');
  });

  it('activation is the start of the prep window', () => {
    const r = run([{ desiredEvent: '2026-12-01', runwayDays: 14 }]);
    expect(toDateOnly(r[0].activationDate)).toBe('2026-11-17');
    expect(toDateOnly(r[0].eventDate)).toBe('2026-12-01');
  });

  it('flags only the initiatives it had to move', () => {
    const r = run([
      { desiredEvent: '2026-12-01', runwayDays: 7 },
      { desiredEvent: '2026-12-01', runwayDays: 7 },
    ]);
    expect(r[0].adjusted).toBe(false);
    expect(r[1].adjusted).toBe(true);
  });

  it('handles an empty plan', () => {
    expect(run([])).toEqual([]);
  });

  it('serialises a crowded plan without ever overlapping', () => {
    const r = run(Array.from({ length: 6 }, () => ({ desiredEvent: '2026-10-01', runwayDays: 21 })));
    const sorted = [...r].sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
    for (let i = 1; i < sorted.length; i++) {
      expect(toDateOnly(sorted[i].activationDate) > toDateOnly(sorted[i - 1].eventDate)).toBe(true);
    }
  });
});
