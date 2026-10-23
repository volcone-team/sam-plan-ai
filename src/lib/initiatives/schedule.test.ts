import { describe, it, expect } from 'vitest';
import {
  activeInWeek,
  countNeedingDates,
  formatScheduleDate,
  horizonSpan,
  inMonthWithoutDay,
  isNewIntake,
  isOngoing,
  launchDate,
  needsDates,
  needsDatesNotice,
  ongoingStale,
  onCalendarDay,
  overlapsPeriod,
  revenueCloseDate,
  schedulePrecision,
  taskAnchorDate,
  type ScheduleFields,
} from './schedule';
import { parseDateOnly, toDateOnly, addDays } from '@/lib/plan-dates';

/* Seeded generator (no fast-check in this project). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const BASE = parseDateOnly('2026-01-01');
const randDay = (r: () => number) => addDays(BASE, Math.floor(r() * 730));
const KINDS = ['one-time', 'recurring', 'evergreen'] as const;

/** A row exactly as every pre-045 initiative looks after mapping. */
function legacyRow(r: () => number): ScheduleFields {
  const activation = randDay(r);
  const hasEvent = r() < 0.7;
  return {
    kind: KINDS[Math.floor(r() * 3)],
    activationDate: activation,
    eventDate: hasEvent ? addDays(activation, Math.floor(r() * 120) - 10) : undefined,
    revenueCloseDate: null,
    activationDatePrecision: 'day',
    eventDatePrecision: 'day',
    categoryId: null,
  };
}

/* The pre-module readers, copied verbatim, as the oracle. */
const oldRangeQuery = (i: ScheduleFields, start: Date, end: Date) => {
  const a = toDateOnly(i.activationDate as Date);
  const e = i.eventDate ? toDateOnly(i.eventDate as Date) : null;
  return a <= toDateOnly(end) && (e === null || e >= toDateOnly(start));
};
const oldWeekly = (init: ScheduleFields, weekStart: Date, end: Date) => {
  const activation = new Date(init.activationDate as Date);
  const eventDate = init.eventDate ? new Date(init.eventDate as Date) : null;
  if (init.kind === 'evergreen') return activation <= end;
  if (eventDate) return activation <= end && eventDate >= weekStart;
  return activation <= end;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const oldCalendar = (init: ScheduleFields, date: Date) => {
  if (init.eventDate && sameDay(new Date(init.eventDate as Date), date)) return true;
  return sameDay(new Date(init.activationDate as Date), date);
};

describe('legacy initiatives behave exactly as before (regression)', () => {
  it('are never classed as new-intake', () => {
    const r = rng(1);
    for (let n = 0; n < 300; n++) expect(isNewIntake(legacyRow(r))).toBe(false);
  });

  it('horizon query matches the old activation/event filter', () => {
    const r = rng(2);
    for (let n = 0; n < 2000; n++) {
      const i = legacyRow(r);
      const start = randDay(r);
      const end = addDays(start, Math.floor(r() * 90));
      expect(overlapsPeriod(i, start, end)).toBe(oldRangeQuery(i, start, end));
    }
  });

  it('weekly filter matches the old planner filter, evergreen quirk included', () => {
    const r = rng(3);
    for (let n = 0; n < 2000; n++) {
      const i = legacyRow(r);
      const weekStart = randDay(r);
      const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 23, 59, 59);
      expect(activeInWeek(i, weekStart, weekEnd)).toBe(oldWeekly(i, weekStart, weekEnd));
    }
    // The quirk itself: an evergreen row with a past event stays in the week.
    const evergreen = { ...legacyRow(rng(9)), kind: 'evergreen', activationDate: '2026-01-01', eventDate: '2026-01-10' };
    expect(activeInWeek(evergreen, parseDateOnly('2026-03-02'), parseDateOnly('2026-03-08'))).toBe(true);
    expect(overlapsPeriod(evergreen, '2026-03-02', '2026-03-08')).toBe(false);
  });

  it('calendar shows them on activation and event days only, evergreen included', () => {
    const r = rng(4);
    for (let n = 0; n < 1000; n++) {
      const i = legacyRow(r);
      const d = randDay(r);
      expect(onCalendarDay(i, d)).toBe(oldCalendar(i, d));
    }
    const evergreen: ScheduleFields = { kind: 'evergreen', activationDate: '2026-02-01' };
    expect(onCalendarDay(evergreen, '2026-02-01')).toBe(true);
    expect(onCalendarDay(evergreen, '2026-02-02')).toBe(false);
  });

  it('are day precision and never need dates', () => {
    const r = rng(5);
    const rows = Array.from({ length: 200 }, () => legacyRow(r));
    expect(rows.every((i) => schedulePrecision(i) === 'day' && !needsDates(i))).toBe(true);
    expect(countNeedingDates(rows)).toBe(0);
    rows.forEach((i) => expect(inMonthWithoutDay(i, 2026, 5)).toBe(false));
  });

  it('launch is the activation date and revenue closes on the event', () => {
    expect(launchDate({ kind: 'one-time', activationDate: '2026-03-01', eventDate: '2026-03-20' })).toBe('2026-03-01');
    expect(revenueCloseDate({ kind: 'one-time', activationDate: '2026-03-01', eventDate: '2026-03-20' })).toBe('2026-03-20');
    expect(revenueCloseDate({ kind: 'evergreen', activationDate: '2026-03-01' })).toBeNull();
  });
});

describe('isNewIntake', () => {
  const legacy: ScheduleFields = { kind: 'one-time', activationDate: '2026-03-01', eventDate: '2026-03-20' };
  it('is triggered by each 045 signal on its own', () => {
    expect(isNewIntake(legacy)).toBe(false);
    expect(isNewIntake({ ...legacy, categoryId: 'webinars' })).toBe(true);
    expect(isNewIntake({ ...legacy, revenueCloseDate: '2026-04-01' })).toBe(true);
    expect(isNewIntake({ ...legacy, activationDatePrecision: 'month' })).toBe(true);
    expect(isNewIntake({ ...legacy, eventDatePrecision: 'month' })).toBe(true);
    expect(isNewIntake({ ...legacy, activationDate: null })).toBe(true);
  });
  it('treats evergreen as the legacy synonym of ongoing', () => {
    expect(isOngoing('evergreen')).toBe(true);
    expect(isOngoing('ongoing')).toBe(true);
    expect(isOngoing('recurring')).toBe(false);
  });
});

describe('horizon for new-intake initiatives: launch to retirement', () => {
  const webinar: ScheduleFields = {
    kind: 'one-time', categoryId: 'webinars',
    activationDate: '2026-03-01', eventDate: '2026-03-20', revenueCloseDate: '2026-04-05',
  };

  it('stays active after the event until revenue closes', () => {
    expect(horizonSpan(webinar)).toEqual({ start: '2026-03-01', end: '2026-04-05' });
    expect(overlapsPeriod(webinar, '2026-03-25', '2026-03-31')).toBe(true);
    expect(overlapsPeriod(webinar, '2026-04-05', '2026-04-30')).toBe(true);
    expect(overlapsPeriod(webinar, '2026-04-06', '2026-04-30')).toBe(false);
    expect(overlapsPeriod(webinar, '2026-02-01', '2026-02-28')).toBe(false);
  });

  it('an ongoing initiative is open-ended from launch, or ends at its review date', () => {
    const ongoing: ScheduleFields = { kind: 'evergreen', categoryId: 'content-media', activationDate: '2026-05-10', eventDate: null };
    expect(horizonSpan(ongoing)).toEqual({ start: '2026-05-10', end: null });
    expect(overlapsPeriod(ongoing, '2030-01-01', '2030-01-31')).toBe(true);
    expect(overlapsPeriod(ongoing, '2026-05-01', '2026-05-09')).toBe(false);
    expect(overlapsPeriod({ ...ongoing, revenueCloseDate: '2026-08-01' }, '2026-09-01', '2026-09-30')).toBe(false);
  });

  it('month-only dates span their whole month', () => {
    const m: ScheduleFields = {
      kind: 'one-time', categoryId: 'webinars',
      activationDate: '2026-03-01', activationDatePrecision: 'month',
      eventDate: '2026-04-01', eventDatePrecision: 'month',
    };
    expect(horizonSpan(m)).toEqual({ start: '2026-03-01', end: '2026-04-30' });
    expect(overlapsPeriod(m, '2026-04-20', '2026-04-26')).toBe(true);
  });

  it('launches on the event when there is no activation date', () => {
    const i: ScheduleFields = { kind: 'one-time', categoryId: 'webinars', activationDate: null, eventDate: '2026-06-15' };
    expect(launchDate(i)).toBe('2026-06-15');
    expect(overlapsPeriod(i, '2026-06-01', '2026-06-30')).toBe(true);
  });

  it('an undated initiative is in no period', () => {
    const i: ScheduleFields = { kind: 'one-time', categoryId: 'webinars', activationDate: null, eventDate: null };
    expect(horizonSpan(i)).toBeNull();
    expect(overlapsPeriod(i, '1900-01-01', '2999-12-31')).toBe(false);
  });

  it('a close date before launch collapses to the launch day rather than inverting', () => {
    const i: ScheduleFields = { ...webinar, revenueCloseDate: '2026-02-01' };
    expect(horizonSpan(i)).toEqual({ start: '2026-03-01', end: '2026-03-01' });
  });

  it('revenue close is revenue_close_date when set, overriding the event', () => {
    expect(revenueCloseDate(webinar)).toBe('2026-04-05');
    expect(revenueCloseDate({ ...webinar, revenueCloseDate: null })).toBe('2026-03-20');
  });
});

describe('weekly view and calendar for new-intake initiatives', () => {
  const monthOnly: ScheduleFields = {
    kind: 'one-time', categoryId: 'webinars', activationDate: '2026-03-01', activationDatePrecision: 'month', eventDate: null,
  };
  const ongoing: ScheduleFields = {
    kind: 'evergreen', categoryId: 'content-media', activationDate: '2026-03-10', eventDate: null, revenueCloseDate: '2026-03-20',
  };

  it('month-only initiatives are kept out of the weekly view', () => {
    expect(overlapsPeriod(monthOnly, '2026-03-02', '2026-03-08')).toBe(true);
    expect(activeInWeek(monthOnly, '2026-03-02', '2026-03-08')).toBe(false);
  });

  it('day-precision new-intake initiatives use the horizon in the weekly view', () => {
    expect(activeInWeek(ongoing, '2026-03-16', '2026-03-22')).toBe(true);
    expect(activeInWeek(ongoing, '2026-03-23', '2026-03-29')).toBe(false);
  });

  it('ongoing initiatives span every day from launch to close on the calendar', () => {
    expect(onCalendarDay(ongoing, '2026-03-09')).toBe(false);
    expect(onCalendarDay(ongoing, '2026-03-10')).toBe(true);
    expect(onCalendarDay(ongoing, '2026-03-15')).toBe(true);
    expect(onCalendarDay(ongoing, '2026-03-20')).toBe(true);
    expect(onCalendarDay(ongoing, '2026-03-21')).toBe(false);
  });

  it('month-only initiatives are listed for the month, never pinned to the 1st', () => {
    expect(onCalendarDay(monthOnly, '2026-03-01')).toBe(false);
    expect(inMonthWithoutDay(monthOnly, 2026, 2)).toBe(true);
    expect(inMonthWithoutDay(monthOnly, 2026, 1)).toBe(false);
  });

  it('a dated one-time new-intake initiative sits on its activation and event days', () => {
    const i: ScheduleFields = { kind: 'one-time', categoryId: 'webinars', activationDate: '2026-03-01', eventDate: '2026-03-20', revenueCloseDate: '2026-04-05' };
    expect(onCalendarDay(i, '2026-03-01')).toBe(true);
    expect(onCalendarDay(i, '2026-03-20')).toBe(true);
    expect(onCalendarDay(i, '2026-03-10')).toBe(false);
  });
});

describe('unscheduled state', () => {
  it('classifies precision and counts month-only plus undated', () => {
    const undated: ScheduleFields = { kind: 'one-time', categoryId: 'webinars', activationDate: null, eventDate: null };
    const monthOnly: ScheduleFields = { kind: 'one-time', categoryId: 'webinars', activationDate: '2026-03-01', activationDatePrecision: 'month' };
    const dated: ScheduleFields = { kind: 'one-time', categoryId: 'webinars', activationDate: '2026-03-04' };
    expect(schedulePrecision(undated)).toBe('unscheduled');
    expect(schedulePrecision(monthOnly)).toBe('month');
    expect(schedulePrecision(dated)).toBe('day');
    // Precision on an absent date is meaningless and ignored.
    expect(schedulePrecision({ ...dated, eventDatePrecision: 'month' })).toBe('day');
    expect(countNeedingDates([undated, monthOnly, dated])).toBe(2);
  });

  it('words the notice for one and many, and says nothing for none', () => {
    expect(needsDatesNotice(0)).toBeNull();
    expect(needsDatesNotice(1)).toBe('1 initiative needs dates before it can be scheduled.');
    expect(needsDatesNotice(3)).toBe('3 initiatives need dates before they can be scheduled.');
  });
});

describe('taskAnchorDate', () => {
  const today = parseDateOnly('2026-07-01');
  it('is event ?? activation ?? today', () => {
    expect(taskAnchorDate({ eventDate: '2026-09-01', activationDate: '2026-08-01' }, today)).toBe('2026-09-01');
    expect(taskAnchorDate({ eventDate: null, activationDate: '2026-08-01' }, today)).toBe('2026-08-01');
    expect(taskAnchorDate({ eventDate: null, activationDate: null }, today)).toBe('2026-07-01');
  });
});

describe('formatScheduleDate', () => {
  it('shows a month-only date as the month alone', () => {
    expect(formatScheduleDate('2026-03-01', 'month')).toBe('March 2026');
    expect(formatScheduleDate('2026-03-01', 'day')).toBe('03/01/2026');
    expect(formatScheduleDate(null, 'day')).toBe('');
  });
});

describe('ongoingStale', () => {
  it('is stale at exactly four weeks without actuals', () => {
    expect(ongoingStale('2026-03-01', '2026-03-28')).toBe(false);
    expect(ongoingStale('2026-03-01', '2026-03-29')).toBe(true);
  });
  it('measures from launch when nothing has been logged yet', () => {
    expect(ongoingStale(null, '2026-03-20', '2026-03-01')).toBe(false);
    expect(ongoingStale(null, '2026-04-01', '2026-03-01')).toBe(true);
    expect(ongoingStale(null, '2026-04-01')).toBe(true);
  });
  it('holds for any gap: stale iff the gap is at least 28 days', () => {
    const r = rng(7);
    for (let n = 0; n < 500; n++) {
      const last = randDay(r);
      const gap = Math.floor(r() * 60);
      expect(ongoingStale(last, addDays(last, gap))).toBe(gap >= 28);
    }
  });
});
