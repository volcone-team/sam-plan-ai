import { describe, it, expect } from 'vitest';
import {
  buildRecurringState,
  correctionUpdate,
  frequencyOf,
  instanceFromDb,
  instanceWriteDecision,
  ongoingRemainingRevenue,
  recurringScope,
  rowFromDb,
  type RecurringRow,
} from './recurring-state';
import type { MaterialisedInstance } from './recurring';

/* Seeded generator (no fast-check in this project). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A new-intake weekly webinar from Tue 2026-03-03: 44 runs in 2026, $1,000 each. */
function weekly(over: Partial<RecurringRow> = {}): RecurringRow {
  return {
    name: 'Weekly webinar',
    kind: 'recurring',
    status: 'planned',
    activationDate: '2026-02-01',
    eventDate: '2026-03-03',
    revenueCloseDate: null,
    activationDatePrecision: 'day',
    eventDatePrecision: 'day',
    categoryId: 'webinars',
    repeatFrequency: null,
    attrs: { repeat_frequency: 'weekly' },
    revenueGood: 44_000,
    createdAt: '2026-01-15T12:00:00Z',
    correctionKeptAt: null,
    ...over,
  };
}

function ongoing(over: Partial<RecurringRow> = {}): RecurringRow {
  return weekly({
    name: 'Podcast',
    kind: 'ongoing',
    attrs: {},
    activationDate: '2026-01-05',
    eventDate: null,
    revenueGood: 36_500,
    ...over,
  });
}

const skipped = (dates: string[], updatedAt = '2026-03-28T09:00:00Z'): MaterialisedInstance[] =>
  dates.map((instanceDate) => ({ instanceDate, outcome: 'skipped', actualRevenue: null, updatedAt }));

describe('rowFromDb / instanceFromDb', () => {
  it('maps snake_case and keeps unknown revenue as null', () => {
    const row = rowFromDb({
      name: 'W',
      kind: 'recurring',
      status: 'planned',
      activation_date: null,
      event_date: '2026-03-03',
      event_date_precision: 'day',
      activation_date_precision: 'day',
      category_id: 'webinars',
      repeat_frequency: 'monthly',
      attrs: null,
      revenue_good: '1200.50',
      correction_kept_at: null,
    });
    expect(row.attrs).toEqual({});
    expect(row.revenueGood).toBe(1200.5);
    expect(row.repeatFrequency).toBe('monthly');
    expect(instanceFromDb({ instance_date: '2026-03-03', outcome: 'ran', actual_revenue: null }).actualRevenue).toBeNull();
    expect(instanceFromDb({ instance_date: '2026-03-03', outcome: 'ran', actual_revenue: '250.00' }).actualRevenue).toBe(250);
  });
});

describe('recurringScope', () => {
  it('a new-intake recurring row with a frequency gets runs from its event date', () => {
    expect(recurringScope(weekly())).toEqual({
      type: 'recurring',
      frequency: 'weekly',
      template: { frequency: 'weekly', firstEventDate: '2026-03-03' },
    });
  });

  it('the repeat_frequency column wins over attrs', () => {
    expect(frequencyOf(weekly({ repeatFrequency: 'monthly' }))).toBe('monthly');
    expect(frequencyOf(weekly({ attrs: { repeat_frequency: 'daily' } }))).toBeNull();
  });

  it('legacy rows, one-time rows, frequency-less and month-only rows get nothing', () => {
    expect(recurringScope(weekly({ categoryId: null })).type).toBe('none'); // legacy
    expect(recurringScope(weekly({ kind: 'one-time' })).type).toBe('none');
    expect(recurringScope(weekly({ attrs: {} })).type).toBe('none');
    expect(recurringScope(weekly({ eventDatePrecision: 'month' })).type).toBe('none');
    expect(recurringScope(weekly({ eventDate: null, activationDate: null })).type).toBe('none');
  });

  it('ongoing and its legacy synonym evergreen are the ongoing variant', () => {
    expect(recurringScope(ongoing()).type).toBe('ongoing');
    expect(recurringScope(ongoing({ kind: 'evergreen' })).type).toBe('ongoing');
    expect(recurringScope(ongoing({ categoryId: null })).type).toBe('none'); // legacy evergreen
  });
});

describe('buildRecurringState — recurring', () => {
  it('asks about a run from the Friday of the following week, and only once answered never again', () => {
    const before = buildRecurringState({ row: weekly(), planYear: 2026, materialised: [], lastActualDate: null, today: '2026-03-12' });
    expect(before.instances).toHaveLength(44);
    expect(before.instances.every((i) => i.goal === 1000)).toBe(true);
    expect(before.duePrompts).toEqual([]);

    const due = buildRecurringState({ row: weekly(), planYear: 2026, materialised: [], lastActualDate: null, today: '2026-03-13' });
    expect(due.duePrompts.map((p) => p.date)).toEqual(['2026-03-03']);

    const answered = buildRecurringState({
      row: weekly(),
      planYear: 2026,
      materialised: [{ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: null }],
      lastActualDate: null,
      today: '2026-03-13',
    });
    expect(answered.duePrompts).toEqual([]);
    expect(answered.instances[0]).toMatchObject({ date: '2026-03-03', state: 'real', outcome: 'ran' });
    expect(answered.correction).toBeNull();
  });

  it('four skips in a row bring the correction prompt with the real lower-frequency figure', () => {
    const s = buildRecurringState({
      row: weekly(),
      planYear: 2026,
      materialised: skipped(['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24']),
      lastActualDate: null,
      today: '2026-04-01',
    });
    expect(s.correction).not.toBeNull();
    expect(s.correction!.heading).toBe('Weekly webinar has been skipped four times in a row.');
    // Runs from 04-07 to 12-29: 39 of them at $1,000.
    expect(s.correction!.body).toContain('$39,000');
    const change = s.correction!.options.find((o) => o.action === 'change-frequency')!;
    expect(change.newFrequency).toBe('bi-weekly');
    // Every 2 weeks from 03-03, from 04-14 to 12-22: 19 runs.
    expect(change.planRevenueAfter).toBe(19000);
    expect(change.detail).toBe('Every 2 weeks instead of weekly. Plan goes to $19,000');
    expect(s.correction!.options.map((o) => o.action)).toEqual(['change-frequency', 'pause', 'retire', 'keep']);
  });

  it('a keep decision after the skips silences the prompt', () => {
    const s = buildRecurringState({
      row: weekly({ correctionKeptAt: '2026-03-30T00:00:00Z' }),
      planYear: 2026,
      materialised: skipped(['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24'], '2026-03-25T10:00:00Z'),
      lastActualDate: null,
      today: '2026-04-01',
    });
    expect(s.correction).toBeNull();
  });

  it('a paused or retired initiative still lists its runs but asks nothing', () => {
    for (const status of ['paused', 'retired']) {
      const s = buildRecurringState({
        row: weekly({ status }),
        planYear: 2026,
        materialised: skipped(['2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24']),
        lastActualDate: null,
        today: '2026-06-01',
      });
      expect(s.instances).toHaveLength(44);
      expect(s.duePrompts).toEqual([]);
      expect(s.correction).toBeNull();
    }
  });

  it('a quarterly initiative offers every 6 months, counted from the real dates', () => {
    const s = buildRecurringState({
      row: weekly({ attrs: { repeat_frequency: 'quarterly' } }),
      planYear: 2026,
      materialised: skipped(['2026-03-03', '2026-06-03', '2026-09-03', '2026-12-03'], '2026-12-20T00:00:00Z'),
      lastActualDate: null,
      today: '2026-12-20',
    });
    expect(s.correction!.options.map((o) => o.action)).toEqual(['change-frequency', 'pause', 'retire', 'keep']);
    const change = s.correction!.options[0];
    expect(change.newFrequency).toBe('semi-annually');
    // Every 6 months from 03-03 is 03-03 and 09-03: none left after 12-20.
    expect(change.planRevenueAfter).toBe(0);
  });

  it('property: due prompts are always untouched placeholders already past their due Friday', () => {
    const r = rng(11);
    for (let n = 0; n < 60; n++) {
      const today = `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const s = buildRecurringState({ row: weekly(), planYear: 2026, materialised: [], lastActualDate: null, today });
      for (const p of s.duePrompts) {
        expect(p.state).toBe('placeholder');
        expect(p.outcome).toBeUndefined();
        expect(p.date < today).toBe(true);
      }
      // And the goals always add back to the template's Good figure.
      expect(s.instances.reduce((t, i) => t + i.goal, 0)).toBe(44_000);
    }
  });
});

describe('buildRecurringState — ongoing', () => {
  const base = { planYear: 2026, materialised: [] as MaterialisedInstance[] };

  it('four weeks after launch with no actuals is the ongoing prompt, with no frequency option', () => {
    const s = buildRecurringState({ ...base, row: ongoing(), lastActualDate: null, today: '2026-03-01' });
    expect(s.scope).toBe('ongoing');
    expect(s.correction!.heading).toBe("Podcast hasn't logged anything in four weeks.");
    expect(s.correction!.options.map((o) => o.action)).toEqual(['pause', 'retire', 'keep']);
  });

  it('a recent actual, a recent keep, or a future launch means no prompt', () => {
    expect(buildRecurringState({ ...base, row: ongoing(), lastActualDate: '2026-02-20', today: '2026-03-01' }).correction).toBeNull();
    expect(
      buildRecurringState({ ...base, row: ongoing({ correctionKeptAt: '2026-02-25T15:00:00Z' }), lastActualDate: null, today: '2026-03-01' }).correction
    ).toBeNull();
    expect(
      buildRecurringState({ ...base, row: ongoing({ activationDate: '2026-04-01' }), lastActualDate: null, today: '2026-03-01' }).correction
    ).toBeNull();
  });

  it('an undated ongoing initiative counts from when it was created', () => {
    const undated = ongoing({ activationDate: null, createdAt: '2026-02-20T10:00:00Z' });
    expect(buildRecurringState({ ...base, row: undated, lastActualDate: null, today: '2026-03-01' }).correction).toBeNull();
    expect(buildRecurringState({ ...base, row: undated, lastActualDate: null, today: '2026-03-20' }).correction).not.toBeNull();
  });

  it('a paused ongoing initiative is never prompted', () => {
    expect(buildRecurringState({ ...base, row: ongoing({ status: 'paused' }), lastActualDate: null, today: '2026-06-01' }).correction).toBeNull();
  });
});

describe('ongoingRemainingRevenue', () => {
  const yearRow = ongoing({ activationDate: '2026-01-01', revenueGood: 36_500 });

  it('prorates by days left in the active span', () => {
    expect(ongoingRemainingRevenue(yearRow, 2026, '2026-01-01')).toBe(36_500);
    // 2026-12-22 .. 12-31 is 10 of 365 days.
    expect(ongoingRemainingRevenue(yearRow, 2026, '2026-12-22')).toBe(1000);
    expect(ongoingRemainingRevenue(yearRow, 2026, '2027-01-01')).toBe(0);
    expect(ongoingRemainingRevenue(ongoing({ activationDate: null }), 2026, '2026-06-01')).toBe(36_500);
  });

  it('property: within [0, good] and never rising as today moves forward', () => {
    const r = rng(7);
    for (let n = 0; n < 40; n++) {
      const start = `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-01`;
      const row = ongoing({ activationDate: start, revenueGood: Math.floor(r() * 100_000) });
      let prev = Infinity;
      for (let m = 1; m <= 12; m++) {
        const v = ongoingRemainingRevenue(row, 2026, `2026-${String(m).padStart(2, '0')}-15`);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(row.revenueGood);
        expect(v).toBeLessThanOrEqual(prev);
        prev = v;
      }
    }
  });
});

describe('instanceWriteDecision', () => {
  const scope = recurringScope(weekly());

  it('accepts one of the template dates in the plan year', () => {
    expect(instanceWriteDecision(scope, 2026, '2026-03-10')).toEqual({ ok: true, value: { instanceDate: '2026-03-10' } });
  });

  it('refuses a date the template does not produce, or one outside the plan year', () => {
    expect(instanceWriteDecision(scope, 2026, '2026-03-11')).toMatchObject({ ok: false, status: 400 });
    expect(instanceWriteDecision(scope, 2026, '2026-02-24')).toMatchObject({ ok: false, status: 400 }); // before the first run
    expect(instanceWriteDecision(scope, 2026, '2027-01-05')).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses ongoing and out-of-scope initiatives', () => {
    expect(instanceWriteDecision(recurringScope(ongoing()), 2026, '2026-03-10')).toMatchObject({ ok: false, status: 409 });
    expect(instanceWriteDecision({ type: 'none' }, 2026, '2026-03-10')).toMatchObject({ ok: false, status: 409 });
  });
});

describe('correctionUpdate', () => {
  const now = '2026-04-01T12:00:00.000Z';

  it('change-frequency lowers the column and keeps attrs in step', () => {
    const row = weekly({ attrs: { repeat_frequency: 'weekly', format: 'digital' } });
    expect(correctionUpdate('change-frequency', recurringScope(row), row, now)).toEqual({
      ok: true,
      value: { repeat_frequency: 'bi-weekly', attrs: { repeat_frequency: 'bi-weekly', format: 'digital' } },
    });
    const colOnly = weekly({ repeatFrequency: 'monthly', attrs: {} });
    expect(correctionUpdate('change-frequency', recurringScope(colOnly), colOnly, now)).toEqual({
      ok: true,
      value: { repeat_frequency: 'bi-monthly' },
    });
    const q = weekly({ repeatFrequency: 'quarterly', attrs: {} });
    expect(correctionUpdate('change-frequency', recurringScope(q), q, now)).toEqual({
      ok: true,
      value: { repeat_frequency: 'semi-annually' },
    });
  });

  it('change-frequency is refused for annually and for ongoing', () => {
    const q = weekly({ attrs: { repeat_frequency: 'annually' } });
    expect(correctionUpdate('change-frequency', recurringScope(q), q, now)).toMatchObject({ ok: false, status: 409 });
    const o = ongoing();
    expect(correctionUpdate('change-frequency', recurringScope(o), o, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('pause, retire and keep write the status or the keep time', () => {
    const row = weekly();
    const scope = recurringScope(row);
    expect(correctionUpdate('pause', scope, row, now)).toEqual({ ok: true, value: { status: 'paused' } });
    expect(correctionUpdate('retire', scope, row, now)).toEqual({ ok: true, value: { status: 'retired' } });
    expect(correctionUpdate('keep', scope, row, now)).toEqual({ ok: true, value: { correction_kept_at: now } });
    expect(correctionUpdate('pause', recurringScope(ongoing()), ongoing(), now)).toEqual({ ok: true, value: { status: 'paused' } });
  });

  it('out-of-scope initiatives are refused', () => {
    const legacy = weekly({ categoryId: null });
    expect(correctionUpdate('pause', recurringScope(legacy), legacy, now)).toMatchObject({ ok: false, status: 409 });
  });
});
