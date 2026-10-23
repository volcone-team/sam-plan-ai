import { describe, it, expect } from 'vitest';
import {
  CORRECTION_ACTIONS,
  INSTANCE_OUTCOMES,
  isInitiativeId,
  parseCalendarDay,
  parseCorrectionRequest,
  parseInstanceRequest,
} from './recurring-request';

/* Seeded generator (no fast-check in this project). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('isInitiativeId', () => {
  it('accepts a uuid and refuses anything Postgres would fail to cast', () => {
    expect(isInitiativeId('0d6f3c1e-5b2a-4c8e-9f10-1a2b3c4d5e6f')).toBe(true);
    expect(isInitiativeId('not-a-uuid')).toBe(false);
    expect(isInitiativeId('')).toBe(false);
    expect(isInitiativeId(undefined)).toBe(false);
  });
});

describe('parseCalendarDay', () => {
  it('accepts real days only', () => {
    expect(parseCalendarDay('2026-03-03')).toBe('2026-03-03');
    expect(parseCalendarDay('2028-02-29')).toBe('2028-02-29');
    expect(parseCalendarDay('2026-02-29')).toBeNull();
    expect(parseCalendarDay('2026-13-01')).toBeNull();
    expect(parseCalendarDay('2026-04-31')).toBeNull();
    expect(parseCalendarDay('2026-03-03T00:00:00Z')).toBeNull();
    expect(parseCalendarDay(20260303)).toBeNull();
  });

  it('property: every day of a year parses back to itself, and day 0 / overflow never does', () => {
    const r = rng(46);
    for (let n = 0; n < 300; n++) {
      const y = 1990 + Math.floor(r() * 60);
      const m = 1 + Math.floor(r() * 12);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const d = 1 + Math.floor(r() * last);
      const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      expect(parseCalendarDay(s)).toBe(s);
      expect(parseCalendarDay(`${y}-${String(m).padStart(2, '0')}-${String(last + 1).padStart(2, '0')}`)).toBeNull();
      expect(parseCalendarDay(`${y}-${String(m).padStart(2, '0')}-00`)).toBeNull();
    }
  });
});

describe('parseInstanceRequest', () => {
  it('accepts each outcome without revenue, leaving revenue absent', () => {
    for (const outcome of INSTANCE_OUTCOMES) {
      const p = parseInstanceRequest({ instanceDate: '2026-03-03', outcome });
      expect(p).toEqual({ ok: true, value: { instanceDate: '2026-03-03', outcome } });
      if (p.ok) expect('actualRevenue' in p.value).toBe(false);
    }
  });

  it('keeps null revenue as null (unknown), never 0', () => {
    const p = parseInstanceRequest({ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: null });
    expect(p.ok && p.value.actualRevenue).toBeNull();
  });

  it('rounds revenue to cents and accepts 0', () => {
    expect(parseInstanceRequest({ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: 1234.567 })).toEqual({
      ok: true,
      value: { instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: 1234.57 },
    });
    const zero = parseInstanceRequest({ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: 0 });
    expect(zero.ok && zero.value.actualRevenue).toBe(0);
  });

  it.each([
    [null],
    [[]],
    ['2026-03-03'],
    [{ outcome: 'ran' }],
    [{ instanceDate: '2026-02-30', outcome: 'ran' }],
    [{ instanceDate: '2026-03-03' }],
    [{ instanceDate: '2026-03-03', outcome: 'skip' }],
    [{ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: -1 }],
    [{ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: '100' }],
    [{ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: Number.NaN }],
    [{ instanceDate: '2026-03-03', outcome: 'ran', actualRevenue: 1e11 }],
  ])('refuses %j', (body) => {
    expect(parseInstanceRequest(body).ok).toBe(false);
  });
});

describe('parseCorrectionRequest', () => {
  it('accepts each action', () => {
    for (const action of CORRECTION_ACTIONS) {
      expect(parseCorrectionRequest({ action })).toEqual({ ok: true, value: { action } });
    }
  });

  it.each([[null], [{}], [{ action: 'delete' }], [{ action: 'PAUSE' }], [[{ action: 'pause' }]]])('refuses %j', (body) => {
    expect(parseCorrectionRequest(body).ok).toBe(false);
  });
});
