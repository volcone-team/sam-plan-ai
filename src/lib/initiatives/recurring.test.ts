import { describe, it, expect } from 'vitest';
import {
  CORRECTION_STREAK,
  correctionOptions,
  instanceDates,
  isOutcomePromptDue,
  lowerFrequency,
  mergeInstances,
  promptDueDate,
  shouldPromptCorrection,
  skipStreak,
  splitGoal,
  type RecurringInstance,
} from './recurring';

/* Seeded generator (no fast-check in this project). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);
const weekday = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();

describe('instanceDates', () => {
  it('weekly runs every 7 days from the first event, inside the year only', () => {
    const d = instanceDates({ frequency: 'weekly', firstEventDate: '2026-03-03' }, 2026);
    expect(d[0]).toBe('2026-03-03');
    expect(d[1]).toBe('2026-03-10');
    expect(d.at(-1)).toBe('2026-12-29');
    expect(d).toHaveLength(44);
  });

  it('monthly from Jan 31 clamps to Feb 28 and returns to the 31st', () => {
    const d = instanceDates({ frequency: 'monthly', firstEventDate: '2026-01-31' }, 2026);
    expect(d).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
    ]);
  });

  it('leap year: Jan 31 monthly lands on Feb 29 in 2028', () => {
    const d = instanceDates({ frequency: 'monthly', firstEventDate: '2026-01-31' }, 2028);
    expect(d.slice(0, 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('quarterly from Nov 30 crosses the year boundary month-end safe', () => {
    expect(instanceDates({ frequency: 'quarterly', firstEventDate: '2025-11-30' }, 2026)).toEqual([
      '2026-02-28', '2026-05-30', '2026-08-30', '2026-11-30',
    ]);
  });

  it('a first event in an earlier year carries the series forward', () => {
    const d = instanceDates({ frequency: 'weekly', firstEventDate: '2025-12-30' }, 2026);
    expect(d[0]).toBe('2026-01-06');
    expect(d.at(-1)).toBe('2026-12-29');
  });

  it('nothing before the first event, nothing for a year before it', () => {
    expect(instanceDates({ frequency: 'monthly', firstEventDate: '2026-10-15' }, 2026)).toEqual([
      '2026-10-15', '2026-11-15', '2026-12-15',
    ]);
    expect(instanceDates({ frequency: 'monthly', firstEventDate: '2026-10-15' }, 2025)).toEqual([]);
  });

  it('the offset shifts every run and can move one across the year boundary', () => {
    const d = instanceDates({ frequency: 'monthly', firstEventDate: '2025-12-31', eventOffsetDays: 2 }, 2026);
    expect(d[0]).toBe('2026-01-02'); // Dec 31 + 2
    expect(d[1]).toBe('2026-02-02'); // Jan 31 + 2
    expect(d[2]).toBe('2026-03-02'); // Feb 28 + 2
    expect(d.at(-1)).toBe('2026-12-02'); // Nov 30 + 2; Dec 31 + 2 is 2027
  });

  it('is empty for no frequency or an invalid date', () => {
    expect(instanceDates({ frequency: null, firstEventDate: '2026-01-01' }, 2026)).toEqual([]);
    expect(instanceDates({ frequency: 'weekly', firstEventDate: '2026-02-30' }, 2026)).toEqual([]);
    expect(instanceDates({ frequency: 'weekly', firstEventDate: null }, 2026)).toEqual([]);
  });

  it('property: ascending, inside the year, on cadence, matching the brute-force series', () => {
    const r = rng(46);
    const freqs = ['weekly', 'monthly', 'quarterly'] as const;
    for (let n = 0; n < 300; n++) {
      const frequency = freqs[Math.floor(r() * 3)];
      const y0 = 2024 + Math.floor(r() * 3);
      const m0 = 1 + Math.floor(r() * 12);
      const d0 = 1 + Math.floor(r() * new Date(Date.UTC(y0, m0, 0)).getUTCDate());
      const first = `${y0}-${String(m0).padStart(2, '0')}-${String(d0).padStart(2, '0')}`;
      const offset = Math.floor(r() * 21) - 10;
      const year = 2025 + Math.floor(r() * 3);
      const got = instanceDates({ frequency, firstEventDate: first, eventOffsetDays: offset }, year);

      // Brute force: walk the series from the first run.
      const want: string[] = [];
      for (let k = 0; k < 400; k++) {
        let e: number;
        if (frequency === 'weekly') e = dayNum(first) + 7 * k + offset;
        else {
          const total = m0 - 1 + k * (frequency === 'monthly' ? 1 : 3);
          const y = y0 + Math.floor(total / 12);
          const m = (total % 12) + 1;
          const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
          e = Math.round(Date.UTC(y, m - 1, Math.min(d0, dim)) / 86_400_000) + offset;
        }
        const s = new Date(e * 86_400_000).toISOString().slice(0, 10);
        if (s.startsWith(String(year))) want.push(s);
      }
      expect(got, `${frequency} ${first} ${offset} ${year}`).toEqual(want);
    }
  });
});

describe('splitGoal and mergeInstances', () => {
  it('splits Good into whole dollars with the remainder on the last run', () => {
    expect(splitGoal(10000, 12)).toEqual([...Array(11).fill(833), 837]);
    expect(splitGoal(2, 4)).toEqual([0, 0, 0, 2]);
    expect(splitGoal(0, 3)).toEqual([0, 0, 0]);
    expect(splitGoal(500, 0)).toEqual([]);
  });

  it('property: the parts always sum to Good and are never negative', () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const good = Math.floor(r() * 1_000_000);
      const n = 1 + Math.floor(r() * 60);
      const parts = splitGoal(good, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(good);
      expect(parts.every(p => p >= 0)).toBe(true);
    }
  });

  it('marks dated rows real, leaves the rest as placeholders, never inventing actuals', () => {
    const dates = ['2026-01-06', '2026-01-13', '2026-01-20'];
    const merged = mergeInstances(
      dates,
      [{ id: 'a', instanceDate: '2026-01-13', outcome: 'ran', actualRevenue: 1200, updatedAt: '2026-01-20T10:00:00Z' }],
      3000
    );
    expect(merged.map(m => [m.date, m.state, m.outcome, m.goal])).toEqual([
      ['2026-01-06', 'placeholder', undefined, 1000],
      ['2026-01-13', 'real', 'ran', 1000],
      ['2026-01-20', 'placeholder', undefined, 1000],
    ]);
    expect(merged[1].actualRevenue).toBe(1200);
    expect(merged[1].id).toBe('a');
    expect(merged[0]).not.toHaveProperty('actualRevenue');
    expect(merged[0]).not.toHaveProperty('outcome');
  });

  it('keeps a real row with no outcome or revenue as unknown, not zero', () => {
    const [m] = mergeInstances(['2026-01-06'], [{ instanceDate: '2026-01-06', outcome: null, actualRevenue: null }]);
    expect(m.state).toBe('real');
    expect(m.outcome).toBeUndefined();
    expect(m.actualRevenue).toBeNull();
  });

  it('keeps a row whose date the template no longer produces, sorted in', () => {
    const merged = mergeInstances(['2026-02-01', '2026-03-01'], [{ instanceDate: '2026-01-15', outcome: 'skipped' }], 300);
    expect(merged.map(m => m.date)).toEqual(['2026-01-15', '2026-02-01', '2026-03-01']);
    expect(merged.map(m => m.goal)).toEqual([100, 100, 100]);
  });

  it('ignores an unknown outcome string and duplicate rows', () => {
    const merged = mergeInstances(['2026-01-06'], [
      { instanceDate: '2026-01-06', outcome: 'maybe' },
      { instanceDate: '2026-01-06', outcome: 'ran' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].outcome).toBeUndefined();
  });
});

describe('promptDueDate', () => {
  it('Tuesday 2026-03-03 is asked about on Friday 2026-03-13', () => {
    expect(promptDueDate('2026-03-03')).toBe('2026-03-13');
  });

  it('weeks start Monday: Mon 03-02 and Sun 03-08 share the due date, Mon 03-09 moves on', () => {
    expect(promptDueDate('2026-03-02')).toBe('2026-03-13');
    expect(promptDueDate('2026-03-08')).toBe('2026-03-13');
    expect(promptDueDate('2026-03-09')).toBe('2026-03-20');
  });

  it('crosses the year boundary', () => {
    expect(promptDueDate('2026-12-29')).toBe('2027-01-08');
  });

  it('property: always a Friday, 5 to 11 days after a Sunday-to-Monday week', () => {
    const r = rng(11);
    for (let i = 0; i < 300; i++) {
      const n = dayNum('2020-01-01') + Math.floor(r() * 4000);
      const d = new Date(n * 86_400_000).toISOString().slice(0, 10);
      const due = promptDueDate(d)!;
      expect(weekday(due)).toBe(5);
      const gap = dayNum(due) - dayNum(d);
      expect(gap).toBeGreaterThanOrEqual(5);
      expect(gap).toBeLessThanOrEqual(11);
    }
  });

  it('is null for an invalid date', () => {
    expect(promptDueDate('nope')).toBeNull();
  });
});

describe('isOutcomePromptDue', () => {
  const placeholder: RecurringInstance = { date: '2026-03-03', state: 'placeholder', goal: 100 };

  it('is due from the Friday onward, not before', () => {
    expect(isOutcomePromptDue(placeholder, '2026-03-12')).toBe(false);
    expect(isOutcomePromptDue(placeholder, '2026-03-13')).toBe(true);
    expect(isOutcomePromptDue(placeholder, '2026-04-01')).toBe(true);
  });

  it('is never due for a touched run', () => {
    expect(isOutcomePromptDue({ ...placeholder, state: 'real' }, '2026-04-01')).toBe(false);
    expect(isOutcomePromptDue({ ...placeholder, outcome: 'skipped' }, '2026-04-01')).toBe(false);
    expect(isOutcomePromptDue({ ...placeholder, actualRevenue: 0 }, '2026-04-01')).toBe(false);
  });
});

describe('skipStreak and shouldPromptCorrection', () => {
  const run = (date: string, outcome?: RecurringInstance['outcome'], outcomeAt?: string): RecurringInstance => ({
    date,
    state: outcome ? 'real' : 'placeholder',
    goal: 0,
    ...(outcome ? { outcome } : {}),
    ...(outcomeAt ? { outcomeAt } : {}),
  });

  it('counts the most recent consecutive skips', () => {
    const list = [run('2026-01-06', 'skipped'), run('2026-01-13', 'ran'), run('2026-01-20', 'skipped'), run('2026-01-27', 'skipped')];
    expect(skipStreak(list)).toBe(2);
  });

  it('ignores unanswered runs (silence is not a skip) and order of input', () => {
    const list = [
      run('2026-02-03'), // future / unanswered placeholder
      run('2026-01-27', 'skipped'),
      run('2026-01-20'),
      run('2026-01-13', 'skipped'),
      run('2026-01-06', 'skipped'),
      run('2025-12-30', 'skipped'),
    ];
    expect(skipStreak(list)).toBe(4);
    expect(shouldPromptCorrection(list)).toBe(true);
  });

  it("'not-yet' ends a streak like 'ran'", () => {
    expect(skipStreak([run('2026-01-06', 'skipped'), run('2026-01-13', 'not-yet')])).toBe(0);
  });

  it('three skips is not enough; four is', () => {
    const three = ['2026-01-06', '2026-01-13', '2026-01-20'].map(d => run(d, 'skipped'));
    expect(shouldPromptCorrection(three)).toBe(false);
    expect(shouldPromptCorrection([...three, run('2026-01-27', 'skipped')])).toBe(true);
    expect(CORRECTION_STREAK).toBe(4);
  });

  it('a keep decision resets the streak; only skips answered after it count', () => {
    const before = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'].map(d => run(d, 'skipped', `${d}T12:00:00Z`));
    const keptAt = '2026-02-06T09:00:00Z';
    expect(shouldPromptCorrection(before, keptAt)).toBe(false);
    expect(skipStreak(before, keptAt)).toBe(0);
    // Feb 3 was answered after the keep (on Feb 13), so it counts despite its date.
    const after = [
      run('2026-02-03', 'skipped', '2026-02-13T12:00:00Z'),
      run('2026-02-10', 'skipped', '2026-02-20T12:00:00Z'),
      run('2026-02-17', 'skipped', '2026-02-27T12:00:00Z'),
    ];
    expect(skipStreak([...before, ...after], keptAt)).toBe(3);
    expect(shouldPromptCorrection([...before, ...after, run('2026-02-24', 'skipped', '2026-03-06T12:00:00Z')], keptAt)).toBe(true);
  });

  it('without outcomeAt the run date is compared to the keep decision', () => {
    const list = [run('2026-01-06', 'skipped'), run('2026-03-03', 'skipped')];
    expect(skipStreak(list, '2026-02-01')).toBe(1);
  });
});

describe('correctionOptions', () => {
  const base = {
    name: 'Weekly webinar',
    remainingRevenue: 24000,
    frequency: 'weekly' as const,
    perInstanceGoal: 1000,
    remainingInstances: 24,
  };

  it('produces the exact copy and deltas for a weekly initiative', () => {
    const p = correctionOptions(base);
    expect(p.heading).toBe('Weekly webinar has been skipped four times in a row.');
    expect(p.body).toBe(
      "That usually means the plan is wrong, not that you're behind. It's still carrying $24,000 for the rest of the year. Pick what's true and the plan will catch up."
    );
    expect(p.options.map(o => [o.label, o.detail])).toEqual([
      ['Change the frequency', 'Monthly instead of weekly. Plan goes to $6,000'],
      ['Pause it', 'Comes off the calendar until you turn it back on. Plan drops $24,000'],
      ['Retire it for this year', 'Off the plan. Plan drops $24,000'],
      ['Keep it as planned', "Nothing changes. We'll ask again after four more"],
    ]);
    expect(p.options.map(o => [o.action, o.planRevenueAfter, o.delta])).toEqual([
      ['change-frequency', 6000, -18000],
      ['pause', 0, -24000],
      ['retire', 0, -24000],
      ['keep', 24000, 0],
    ]);
    expect(p.options[0].newFrequency).toBe('monthly');
    expect(p.dismissLabel).toBe('Not now');
  });

  it('monthly goes to quarterly; an exact lower-frequency count wins over scaling', () => {
    const p = correctionOptions({ ...base, frequency: 'monthly', remainingInstances: 6, lowerFrequencyRemainingInstances: 3, remainingRevenue: 6000 });
    expect(p.options[0].detail).toBe('Quarterly instead of monthly. Plan goes to $3,000');
    expect(p.options[0].delta).toBe(-3000);
  });

  it('omits the frequency option for quarterly and for no frequency', () => {
    expect(correctionOptions({ ...base, frequency: 'quarterly' }).options.map(o => o.action)).toEqual(['pause', 'retire', 'keep']);
    expect(correctionOptions({ ...base, frequency: null }).options.map(o => o.action)).toEqual(['pause', 'retire', 'keep']);
    expect(lowerFrequency('quarterly')).toBeNull();
  });

  it('ongoing variant heading', () => {
    const p = correctionOptions({ ...base, name: 'LinkedIn posting', frequency: null, variant: 'ongoing' });
    expect(p.heading).toBe("LinkedIn posting hasn't logged anything in four weeks.");
  });

  it('bad money reads as $0 with no negative zero', () => {
    const p = correctionOptions({ ...base, remainingRevenue: NaN, frequency: null });
    expect(p.body).toContain('carrying $0 for');
    expect(Object.is(p.options[0].delta, 0)).toBe(true);
  });
});
