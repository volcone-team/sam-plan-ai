import { describe, it, expect } from 'vitest';
import { buildInitiativeUpdate } from './build-update';
import type { UpdateInitiativeDTO } from '@/types';

const UUID = '3f2b9c1e-8a4d-4e6f-9b2a-1c3d5e7f9a0b';

describe('buildInitiativeUpdate', () => {
  it('sends "" productId as null (product_id is nullable, never "")', () => {
    expect(buildInitiativeUpdate({ productId: '' })).toEqual({ product_id: null });
    expect(buildInitiativeUpdate({ productId: null })).toEqual({ product_id: null });
  });

  it('skips "" initiativeTypeId (initiative_type_id is NOT NULL)', () => {
    expect(buildInitiativeUpdate({ initiativeTypeId: '' })).toEqual({});
  });

  it('keeps valid uuids', () => {
    expect(buildInitiativeUpdate({ productId: UUID, initiativeTypeId: UUID })).toEqual({
      product_id: UUID,
      initiative_type_id: UUID,
    });
  });

  it('sends "" or null dates as null', () => {
    const dto = { activationDate: '', eventDate: null } as unknown as UpdateInitiativeDTO;
    expect(buildInitiativeUpdate(dto)).toEqual({ activation_date: null, event_date: null });
  });

  it('writes a local calendar day and the given precision', () => {
    const row = buildInitiativeUpdate({
      activationDate: new Date(2026, 10, 14),
      activationDatePrecision: 'day',
      eventDate: new Date(2026, 11, 2),
      eventDatePrecision: 'day',
    });
    expect(row).toEqual({
      activation_date: '2026-11-14',
      activation_date_precision: 'day',
      event_date: '2026-12-02',
      event_date_precision: 'day',
    });
  });

  it('leaves precision untouched when not given', () => {
    const row = buildInitiativeUpdate({ activationDate: new Date(2026, 10, 14) });
    expect(row).not.toHaveProperty('activation_date_precision');
  });

  it('passes unrelated fields through unchanged', () => {
    expect(
      buildInitiativeUpdate({
        name: 'Webinar',
        status: 'planned',
        plannedBudget: 250,
        revenueScenarios: { good: 1, better: 2, best: 3 },
      })
    ).toEqual({
      name: 'Webinar',
      status: 'planned',
      planned_budget: 250,
      revenue_good: 1,
      revenue_better: 2,
      revenue_best: 3,
    });
  });

  it('never writes "" to a uuid or date column, for any blank-ish input', () => {
    // Exhaustive over every combination (5^4), no generator library needed.
    const blanks = ['', ' ', '  ', null, undefined];
    for (const p of blanks) for (const t of blanks) for (const a of blanks) for (const e of blanks) {
      const row = buildInitiativeUpdate({
        productId: p,
        initiativeTypeId: t,
        activationDate: a,
        eventDate: e,
      } as unknown as UpdateInitiativeDTO);
      for (const col of ['product_id', 'initiative_type_id', 'activation_date', 'event_date']) {
        expect(row[col]).not.toBe('');
      }
      expect(row).not.toHaveProperty('initiative_type_id');
    }
  });
});
