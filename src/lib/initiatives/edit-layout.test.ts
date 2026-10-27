import { describe, it, expect } from 'vitest';
import { editLayout, toFormKind, toStoredKind } from './edit-layout';
import type { LibraryRecordConfig } from '@/lib/intake-v3/library-config';
import { buildInitiativeUpdate } from './build-update';

const config = (over: Partial<LibraryRecordConfig> = {}): LibraryRecordConfig => ({
  initiativeKey: 'k',
  isLaunch: true,
  allowedKinds: ['one-time'],
  allowedPaths: ['offer'],
  audienceSource: 'own',
  revenueLines: [],
  fieldExtras: [],
  allowedFrequencies: [],
  ...over,
});

describe('kind vocabulary', () => {
  it('maps evergreen <-> ongoing', () => {
    expect(toFormKind('evergreen')).toBe('ongoing');
    expect(toStoredKind('ongoing')).toBe('evergreen');
    expect(toFormKind('nonsense')).toBeNull();
  });
});

describe('editLayout without a library config', () => {
  it('offers every field, as before, plus kind', () => {
    const l = editLayout({ config: null, categoryId: null, kind: 'one-time' });
    expect(l.kind.shown).toBe(true);
    expect(l.kind.options.map((o) => o.value)).toEqual(['one-time', 'recurring', 'evergreen']);
    expect(l.start).toEqual({ shown: true, required: true });
    expect(l.event.shown).toBe(true);
    expect(l.frequency.shown).toBe(false);
    expect(l.close.shown).toBe(false);
  });

  it('asks how often for a recurring initiative, from all seven frequencies', () => {
    const l = editLayout({ config: null, categoryId: null, kind: 'recurring' });
    expect(l.frequency.shown).toBe(true);
    expect(l.frequency.options).toHaveLength(7);
  });

  it('keeps an existing close date editable', () => {
    expect(editLayout({ config: null, categoryId: null, kind: 'one-time', hasCloseDate: true }).close.shown).toBe(true);
  });
});

describe('editLayout follows the Add form rules', () => {
  const webinars = config({
    allowedKinds: ['one-time', 'recurring', 'ongoing'],
    allowedFrequencies: ['weekly', 'monthly'],
    ongoingLabel: 'Evergreen',
  });

  it('hides the start date when the workbook says No', () => {
    const l = editLayout({ config: config({ askStartDate: false }), categoryId: 'webinars', kind: 'one-time', conversionPath: 'offer' });
    expect(l.start.shown).toBe(false);
    expect(l.event).toEqual({ shown: true, required: true });
  });

  it('hides the event date when the workbook says No', () => {
    const l = editLayout({ config: config({ askEventDate: false }), categoryId: 'webinars', kind: 'one-time', conversionPath: 'offer' });
    expect(l.event.shown).toBe(false);
    expect(l.start.shown).toBe(true);
  });

  it('shows kind only when the record allows more than one, with its own ongoing word', () => {
    expect(editLayout({ config: config(), categoryId: 'webinars', kind: 'one-time' }).kind.shown).toBe(false);
    const l = editLayout({ config: webinars, categoryId: 'webinars', kind: 'one-time' });
    expect(l.kind.shown).toBe(true);
    expect(l.kind.options).toEqual([
      { value: 'one-time', label: 'One-time' },
      { value: 'recurring', label: 'Recurring' },
      { value: 'evergreen', label: 'Evergreen' },
    ]);
  });

  it('asks how often only while recurring, from the allowed frequencies', () => {
    expect(editLayout({ config: webinars, categoryId: 'webinars', kind: 'one-time' }).frequency.shown).toBe(false);
    const l = editLayout({ config: webinars, categoryId: 'webinars', kind: 'recurring' });
    expect(l.frequency.shown).toBe(true);
    expect(l.frequency.options.map((o) => o.value)).toEqual(['weekly', 'monthly']);
    expect(l.event.required).toBe(false);
  });

  it('writes a single allowed frequency silently', () => {
    const l = editLayout({
      config: config({ allowedKinds: ['recurring'], allowedFrequencies: ['monthly'] }),
      categoryId: 'webinars',
      kind: 'recurring',
    });
    expect(l.frequency.shown).toBe(false);
    expect(l.silentFrequency).toBe('monthly');
  });

  it('drops the event date for ongoing work but keeps the start', () => {
    const l = editLayout({ config: webinars, categoryId: 'webinars', kind: 'evergreen' });
    expect(l.event.shown).toBe(false);
    expect(l.start.shown).toBe(true);
  });

  it('uses the close-date wording for the conversion path', () => {
    expect(editLayout({ config: config(), categoryId: 'webinars', kind: 'one-time', conversionPath: 'offer' }).close).toMatchObject({
      shown: true,
      label: 'Cart closes',
      required: true,
    });
  });

  it('falls back to every field for an unknown category', () => {
    expect(editLayout({ config: config({ askStartDate: false }), categoryId: 'nope', kind: 'one-time' }).start.shown).toBe(true);
  });
});

describe('buildInitiativeUpdate: schedule fields', () => {
  it('writes kind, frequency and close date, and clears with null / blank', () => {
    expect(
      buildInitiativeUpdate({ kind: 'recurring', repeatFrequency: 'weekly', revenueCloseDate: new Date(2027, 5, 30) })
    ).toEqual({ kind: 'recurring', repeat_frequency: 'weekly', revenue_close_date: '2027-06-30' });
    expect(buildInitiativeUpdate({ repeatFrequency: null, revenueCloseDate: null })).toEqual({
      repeat_frequency: null,
      revenue_close_date: null,
    });
    expect(buildInitiativeUpdate({ repeatFrequency: '' })).toEqual({ repeat_frequency: null });
  });

  it('leaves them alone when not given', () => {
    expect(buildInitiativeUpdate({ name: 'x' })).toEqual({ name: 'x' });
  });
});
