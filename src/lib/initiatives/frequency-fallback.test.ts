import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_FREQUENCIES,
  initiativeFrequencyFallback,
  intakeFrequencyFallback,
  isCheckViolation,
  withFrequencyFallback,
} from './frequency-fallback';
import { REPEAT_FREQUENCIES } from '@/lib/intake-forecast';

type Row = Record<string, unknown>;
type Res = { error: { code?: string; message?: string } | null; data?: unknown };
const CHECK = { code: '23514', message: 'new row violates check constraint "initiatives_repeat_frequency_check"' };

afterEach(() => vi.restoreAllMocks());

describe('isCheckViolation', () => {
  it('is true only for 23514', () => {
    expect(isCheckViolation(CHECK)).toBe(true);
    expect(isCheckViolation({ code: '23505' })).toBe(false);
    expect(isCheckViolation(null)).toBe(false);
    expect(isCheckViolation(undefined)).toBe(false);
  });
});

describe('initiativeFrequencyFallback', () => {
  it('moves a new frequency into attrs and nulls the column', () => {
    expect(initiativeFrequencyFallback({ name: 'W', repeat_frequency: 'bi-weekly', attrs: { format: 'digital' } })).toEqual({
      name: 'W',
      repeat_frequency: null,
      attrs: { format: 'digital', repeat_frequency: 'bi-weekly' },
    });
  });

  it('keeps the current attrs for an update that does not carry them', () => {
    expect(initiativeFrequencyFallback({ repeat_frequency: 'semi-annually' }, { format: 'digital', host: 'x' })).toEqual({
      repeat_frequency: null,
      attrs: { format: 'digital', host: 'x', repeat_frequency: 'semi-annually' },
    });
  });

  it('is null for a legacy value, null or no frequency', () => {
    for (const f of LEGACY_FREQUENCIES) expect(initiativeFrequencyFallback({ repeat_frequency: f })).toBeNull();
    expect(initiativeFrequencyFallback({ repeat_frequency: null })).toBeNull();
    expect(initiativeFrequencyFallback({ name: 'x' })).toBeNull();
  });

  it('applies to exactly the four values 051 adds', () => {
    const touched = REPEAT_FREQUENCIES.filter((f) => initiativeFrequencyFallback({ repeat_frequency: f }) !== null);
    expect(touched).toEqual(['bi-weekly', 'bi-monthly', 'semi-annually', 'annually']);
  });
});

describe('intakeFrequencyFallback', () => {
  it('nulls only the new values and keeps the legacy ones', () => {
    expect(
      intakeFrequencyFallback([
        { initiative_key: 'a', repeat_frequency: 'weekly' },
        { initiative_key: 'b', repeat_frequency: 'annually' },
        { initiative_key: 'c', repeat_frequency: null },
      ])
    ).toEqual([
      { initiative_key: 'a', repeat_frequency: 'weekly' },
      { initiative_key: 'b', repeat_frequency: null },
      { initiative_key: 'c', repeat_frequency: null },
    ]);
  });

  it('is null when no row has a new value', () => {
    expect(intakeFrequencyFallback([{ repeat_frequency: 'monthly' }, { repeat_frequency: null }])).toBeNull();
    expect(intakeFrequencyFallback([])).toBeNull();
  });
});

describe('withFrequencyFallback', () => {
  it('returns the first result when it succeeds, without retrying', async () => {
    const run = vi.fn(async (): Promise<Res> => ({ error: null, data: { id: '1' } }));
    const out = await withFrequencyFallback<Row, Res>({ repeat_frequency: 'bi-weekly' }, run, (r) => initiativeFrequencyFallback(r), '[t]');
    expect(out).toEqual({ error: null, data: { id: '1' } });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries once with the fallback payload on a check violation, and logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: Record<string, unknown>[] = [];
    const run = async (row: Record<string, unknown>): Promise<Res> => {
      seen.push(row);
      return row.repeat_frequency === 'bi-weekly' ? { error: CHECK } : { error: null, data: { id: '2' } };
    };
    const out = await withFrequencyFallback<Row, Res>({ repeat_frequency: 'bi-weekly' }, run, (r) => initiativeFrequencyFallback(r), '[t]');
    expect(out).toEqual({ error: null, data: { id: '2' } });
    expect(seen).toEqual([{ repeat_frequency: 'bi-weekly' }, { repeat_frequency: null, attrs: { repeat_frequency: 'bi-weekly' } }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries at most once: a second failure is returned as is', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn(async (): Promise<Res> => ({ error: CHECK }));
    const out = await withFrequencyFallback<Row, Res>({ repeat_frequency: 'annually' }, run, (r) => initiativeFrequencyFallback(r), '[t]');
    expect(out.error).toEqual(CHECK);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors, or a check violation with nothing to strip', async () => {
    const other = vi.fn(async (): Promise<Res> => ({ error: { code: '23502', message: 'not null' } }));
    await withFrequencyFallback<Row, Res>({ repeat_frequency: 'bi-weekly' }, other, (r) => initiativeFrequencyFallback(r), '[t]');
    expect(other).toHaveBeenCalledTimes(1);

    const legacy = vi.fn(async (): Promise<Res> => ({ error: CHECK }));
    const out = await withFrequencyFallback<Row, Res>({ repeat_frequency: 'weekly' }, legacy, (r) => initiativeFrequencyFallback(r), '[t]');
    expect(out.error).toEqual(CHECK);
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it('works for a multi-row intake insert', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: Record<string, unknown>[][] = [];
    const run = async (rows: Record<string, unknown>[]): Promise<Res> => {
      calls.push(rows);
      return rows.some((r) => r.repeat_frequency === 'bi-monthly') ? { error: CHECK } : { error: null };
    };
    const out = await withFrequencyFallback(
      [{ repeat_frequency: 'bi-monthly' }, { repeat_frequency: 'quarterly' }],
      run,
      intakeFrequencyFallback,
      '[t]'
    );
    expect(out.error).toBeNull();
    expect(calls[1]).toEqual([{ repeat_frequency: null }, { repeat_frequency: 'quarterly' }]);
  });
});
