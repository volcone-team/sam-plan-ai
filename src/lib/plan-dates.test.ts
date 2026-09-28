import { describe, it, expect } from 'vitest';
import {
  parseDateOnly, toDateOnly, addDays, subDays, isSameDateOnly, isWithinDateOnly,
  resolveLeadDays, computeTaskDueDate, clampDayOfMonth, daysInMonth, DEFAULT_LEAD_DAYS,
  resolvePlanStart, planMonthToCalendar, clampNotBefore, todayDateOnly,
  earliestEventDate, laterDateOnly, requiredRunwayDays,
} from '@/lib/plan-dates';

describe('parseDateOnly / toDateOnly', () => {
  it('parses to LOCAL midnight, not UTC midnight', () => {
    const d = parseDateOnly('2026-08-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(31);   // the bug: UTC parsing gave the 30th
    expect(d.getHours()).toBe(0);
  });

  it('round-trips every calendar day unchanged', () => {
    for (const s of ['2026-01-01', '2026-02-28', '2026-08-31', '2026-12-31', '2027-01-01']) {
      expect(toDateOnly(parseDateOnly(s))).toBe(s);
    }
  });

  it('formats from the local day without toISOString', () => {
    expect(toDateOnly(new Date(2026, 7, 31))).toBe('2026-08-31');
    expect(toDateOnly(new Date(2027, 0, 1))).toBe('2027-01-01');
  });
});

describe('addDays / subDays', () => {
  it('crosses a month boundary correctly', () => {
    expect(toDateOnly(subDays('2026-09-14', 14))).toBe('2026-08-31');
  });
  it('crosses a year boundary correctly', () => {
    expect(toDateOnly(subDays('2027-01-05', 10))).toBe('2026-12-26');
  });
  it('handles leap day', () => {
    expect(toDateOnly(addDays('2028-02-28', 1))).toBe('2028-02-29');
  });
});

describe('window membership', () => {
  it('is inclusive at both ends', () => {
    expect(isWithinDateOnly('2026-08-31', '2026-08-31', '2026-09-06')).toBe(true);
    expect(isWithinDateOnly('2026-09-06', '2026-08-31', '2026-09-06')).toBe(true);
    expect(isWithinDateOnly('2026-09-07', '2026-08-31', '2026-09-06')).toBe(false);
  });
  it('spans a year boundary', () => {
    expect(isWithinDateOnly('2027-01-01', '2026-12-28', '2027-01-03')).toBe(true);
  });
  it('isSameDateOnly ignores time', () => {
    expect(isSameDateOnly('2026-08-31', new Date(2026, 7, 31, 23, 59))).toBe(true);
  });
});

describe('resolveLeadDays', () => {
  it('takes the magnitude so a wrong sign cannot invert the schedule', () => {
    expect(resolveLeadDays(14)).toBe(14);
    expect(resolveLeadDays(-21)).toBe(21);
  });
  it('keeps zero as zero', () => {
    expect(resolveLeadDays(0)).toBe(0);
  });
  it('falls back on unusable input', () => {
    for (const bad of [undefined, null, NaN, Infinity, 'abc', {}]) {
      expect(resolveLeadDays(bad)).toBe(DEFAULT_LEAD_DAYS);
    }
  });
});

describe('computeTaskDueDate', () => {
  it('reproduces the reviewer case: Sep 14 event, 14d lead -> Aug 31', () => {
    expect(toDateOnly(computeTaskDueDate('2026-09-14', 14))).toBe('2026-08-31');
  });
  it('Sep 14 event, 20d lead -> Aug 25', () => {
    expect(toDateOnly(computeTaskDueDate('2026-09-14', 20))).toBe('2026-08-25');
  });
  it('zero lead lands on the event date', () => {
    expect(toDateOnly(computeTaskDueDate('2026-09-14', 0))).toBe('2026-09-14');
  });
  it('is NEVER after the anchor, for any input', () => {
    const anchor = '2026-09-14';
    for (const lead of [0, 1, 14, -14, -0.5, 999, NaN, Infinity, undefined, null, 'x']) {
      expect(toDateOnly(computeTaskDueDate(anchor, lead)) <= anchor).toBe(true);
    }
  });
});

describe('clampDayOfMonth', () => {
  it('clamps past the end of a short month', () => {
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
    expect(clampDayOfMonth(2028, 2, 31)).toBe(29);
    expect(clampDayOfMonth(2026, 9, 31)).toBe(30);
  });
  it('keeps a valid day and floors nonsense to 1', () => {
    expect(clampDayOfMonth(2026, 9, 14)).toBe(14);
    expect(clampDayOfMonth(2026, 9, 0)).toBe(1);
    expect(clampDayOfMonth(2026, 9, NaN)).toBe(1);
  });
  it('daysInMonth is 1-indexed', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe('resolvePlanStart', () => {
  const sep2026 = new Date(2026, 8, 27); // 27 Sep 2026

  it('starts at the current month when the selected year IS this year', () => {
    expect(resolvePlanStart(2026, sep2026)).toEqual({ startYear: 2026, startMonth: 9 });
  });
  it('starts at the current month when no year is selected', () => {
    expect(resolvePlanStart(undefined, sep2026)).toEqual({ startYear: 2026, startMonth: 9 });
  });
  it('starts in January for a future year', () => {
    expect(resolvePlanStart(2027, sep2026)).toEqual({ startYear: 2027, startMonth: 1 });
  });
  it('starts in January for a past year', () => {
    expect(resolvePlanStart(2025, sep2026)).toEqual({ startYear: 2025, startMonth: 1 });
  });
  it('never generates into the past for the current year', () => {
    for (let m = 0; m < 12; m++) {
      const now = new Date(2026, m, 15);
      expect(resolvePlanStart(2026, now).startMonth).toBe(m + 1);
    }
  });
});

describe('planMonthToCalendar', () => {
  it('a 12-month plan from Sep 2026 ends Aug 2027', () => {
    expect(planMonthToCalendar(2026, 9, 1)).toEqual({ year: 2026, month: 9 });
    expect(planMonthToCalendar(2026, 9, 4)).toEqual({ year: 2026, month: 12 });
    expect(planMonthToCalendar(2026, 9, 5)).toEqual({ year: 2027, month: 1 });
    expect(planMonthToCalendar(2026, 9, 12)).toEqual({ year: 2027, month: 8 });
  });
  it('no plan month lands before the start', () => {
    for (let pm = 1; pm <= 12; pm++) {
      const { year, month } = planMonthToCalendar(2026, 9, pm);
      expect(year * 12 + month).toBeGreaterThanOrEqual(2026 * 12 + 9);
    }
  });
  it('defaults a missing plan month to the start month', () => {
    expect(planMonthToCalendar(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
  });
});

describe('clampNotBefore / todayDateOnly', () => {
  const today = new Date(2026, 8, 27); // 27 Sep 2026

  it('pushes a past date up to the floor', () => {
    expect(toDateOnly(clampNotBefore('2026-09-01', today))).toBe('2026-09-27');
    expect(toDateOnly(clampNotBefore('2026-09-15', today))).toBe('2026-09-27');
  });
  it('leaves a future date alone', () => {
    expect(toDateOnly(clampNotBefore('2026-10-05', today))).toBe('2026-10-05');
    expect(toDateOnly(clampNotBefore('2027-03-01', today))).toBe('2027-03-01');
  });
  it('is a no-op on the floor itself', () => {
    expect(toDateOnly(clampNotBefore('2026-09-27', today))).toBe('2026-09-27');
  });
  it('strips time from today', () => {
    const d = todayDateOnly(new Date(2026, 8, 27, 23, 45));
    expect(d.getHours()).toBe(0);
    expect(toDateOnly(d)).toBe('2026-09-27');
  });
  it('no generated date for a current-month plan can precede today', () => {
    const { startYear, startMonth } = resolvePlanStart(2026, today);
    const cal = planMonthToCalendar(startYear, startMonth, 1);
    const activation = clampNotBefore(new Date(cal.year, cal.month - 1, 1), today);
    const event = clampNotBefore(new Date(cal.year, cal.month - 1, 15), activation);
    const due = clampNotBefore(computeTaskDueDate(event, 14), today);
    for (const d of [activation, event, due]) {
      expect(toDateOnly(d) >= '2026-09-27').toBe(true);
    }
  });
});

describe('requiredRunwayDays', () => {
  it('is the LARGEST task lead, because that task must still be doable', () => {
    expect(requiredRunwayDays([
      { daysBeforeEvent: 3 }, { daysBeforeEvent: 21 }, { daysBeforeEvent: 7 },
    ])).toBe(21);
  });
  it('is zero when there is nothing to prepare', () => {
    expect(requiredRunwayDays([])).toBe(0);
    expect(requiredRunwayDays(undefined)).toBe(0);
    expect(requiredRunwayDays(null)).toBe(0);
  });
  it('uses magnitude, so a wrongly signed lead still reserves runway', () => {
    expect(requiredRunwayDays([{ daysBeforeEvent: -14 }])).toBe(14);
  });
  it('falls back for unusable leads, matching due-date resolution', () => {
    expect(requiredRunwayDays([{ daysBeforeEvent: 'x' }])).toBe(DEFAULT_LEAD_DAYS);
  });
  it('a short-runway initiative is not forced out as far as a long one', () => {
    expect(requiredRunwayDays([{ daysBeforeEvent: 3 }])).toBe(3);
  });
});

describe('earliestEventDate', () => {
  const today = new Date(2026, 8, 27); // 27 Sep 2026

  it('is today plus the derived runway', () => {
    expect(toDateOnly(earliestEventDate(21, today))).toBe('2026-10-18');
    expect(toDateOnly(earliestEventDate(3, today))).toBe('2026-09-30');
    expect(toDateOnly(earliestEventDate(0, today))).toBe('2026-09-27');
  });
  it('crosses a month boundary correctly', () => {
    expect(toDateOnly(earliestEventDate(10, new Date(2026, 8, 25)))).toBe('2026-10-05');
  });
  it('treats a negative runway as none', () => {
    expect(toDateOnly(earliestEventDate(-5, today))).toBe('2026-09-27');
  });
  it('leaves an event that already has runway alone', () => {
    expect(toDateOnly(clampNotBefore('2026-12-01', earliestEventDate(21, today)))).toBe('2026-12-01');
  });
  it('EVERY task of a clamped initiative is due today or later', () => {
    const tasks = [{ daysBeforeEvent: 21 }, { daysBeforeEvent: 7 }, { daysBeforeEvent: 0 }];
    const runway = requiredRunwayDays(tasks);
    const event = clampNotBefore(new Date(2026, 8, 28), earliestEventDate(runway, today));
    for (const t of tasks) {
      expect(toDateOnly(computeTaskDueDate(event, t.daysBeforeEvent)) >= '2026-09-27').toBe(true);
    }
  });
  it('an event is never before its activation date', () => {
    const activation = todayDateOnly(today);
    expect(toDateOnly(laterDateOnly(earliestEventDate(10, today), activation)) >= toDateOnly(activation)).toBe(true);
  });
});
