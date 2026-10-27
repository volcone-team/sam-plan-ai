import { describe, expect, it } from 'vitest';
import { ASK_UNDECIDED, type LibraryRecordConfig } from '@/lib/intake-v3/library-config';
import {
  NO_PROMOTION_NEEDED,
  PROMOTION_ADS,
  PROMOTION_SOMEONE_ELSE,
  initialDraft,
  type IntakeDraft,
} from '@/lib/intake-v3/universal-form';
import type { PickerItem } from '@/lib/intake-v3/picker';
import {
  AD_PLATFORM_OPTIONS,
  COMMISSION_BASIS_OPTIONS,
  PROMOTION_OPTIONS,
  PROMO_SEND_OPTIONS,
  RECRUITMENT_OPTIONS,
  commissionRateLabel,
  commissionView,
  fromYesNo,
  toYesNo,
  toggleIn,
  bookingHelp,
  errorDomId,
  fieldDomId,
  formStartDraft,
  frequencyOptions,
  kindOptions,
  moneyOrDash,
  noPromotionBody,
  pathOptions,
  revenueLineLabel,
  revenueModeFor,
  revenueView,
  setDatePrecision,
  togglePromotion,
  NO_PROMOTION_ACTIONS,
  clearNoPromotion,
  promoteBySomeoneElse,
  showNoPromotionWarning,
} from './intake-form-view';

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

const item: PickerItem = { key: 'k', name: 'Live Webinar', oneLiner: null, categoryId: 'webinars', audience: 'own' };

const line = (id: string) => ({
  id,
  priceSource: 'product.price' as const,
  windowOpens: 'event_date' as const,
  windowCloses: 'close_date' as const,
});
const TWO_LINES = config({ revenueLines: [line('core'), line('vip_tier')] });

describe('options and labels', () => {
  it('labels ongoing with the record word', () => {
    const opts = kindOptions({ allowedKinds: ['one-time', 'recurring', 'ongoing'] }, { ongoingLabel: 'Evergreen' });
    expect(opts.map(o => o.label)).toEqual(['One-time', 'Recurring', 'Evergreen']);
  });

  it('describes each kind under its option', () => {
    const opts = kindOptions({ allowedKinds: ['one-time', 'recurring', 'ongoing'] }, { ongoingLabel: 'Evergreen' });
    expect(opts.map(o => o.description)).toEqual([
      'A single dated promo with an event.',
      'A schedule that spawns instances.',
      'Always on, no event date.',
    ]);
  });

  it("adds \"I don't know yet\" only where the category offers it", () => {
    const layout = { availablePaths: ['offer', 'calls', 'leads', 'speaker-fee'] as const };
    expect(pathOptions(layout, 'webinars').map(o => o.label)).toEqual([
      'Make an offer',
      'Drive to calls',
      'Collect leads',
      'Speaker fee',
    ]);
    const stage = pathOptions(layout, 'other-peoples-stages-in-person');
    expect(stage.at(-1)).toEqual({ value: ASK_UNDECIDED, label: "I don't know yet" });
  });

  it('lists only allowed frequencies', () => {
    expect(frequencyOptions({ allowedFrequencies: ['monthly'] })).toEqual([{ value: 'monthly', label: 'Monthly' }]);
  });

  it('names the partner in the booking help', () => {
    expect(bookingHelp(' Acme ')).toBe("Booked means you have the date in writing from Acme. A verbal yes isn't booked.");
    expect(bookingHelp(null)).toContain('from your partner.');
  });

  it('humanises revenue line ids', () => {
    expect(revenueLineLabel('vip_tier')).toBe('Vip tier');
    expect(revenueLineLabel('')).toBe('Revenue');
  });

  it('formats money or a dash', () => {
    expect(moneyOrDash(null)).toBe('—');
    expect(moneyOrDash(12500)).toBe('$12,500');
  });

  it('builds DOM ids for dotted keys', () => {
    expect(fieldDomId('b', 'dates.close')).toBe('b-dates-close');
    expect(errorDomId('b', 'revenue.lines.vip')).toBe('b-revenue-lines-vip-error');
  });
});

describe('promotion', () => {
  it('offers "No promotion needed" as the stored constant', () => {
    expect(PROMOTION_OPTIONS.at(-1)).toEqual({ value: NO_PROMOTION_NEEDED, label: 'No promotion needed' });
  });

  it('keeps "No promotion needed" exclusive, for any sequence of toggles', () => {
    const values = PROMOTION_OPTIONS.map(o => o.value);
    // Every sequence of three toggles (7^3), from every one of them as a start.
    for (const a of values) for (const b of values) for (const c of values) {
      const result = [a, b, c].reduce<string[]>((acc, v) => togglePromotion(acc, v), []);
      expect(new Set(result).size).toBe(result.length);
      if (result.includes(NO_PROMOTION_NEEDED)) expect(result).toEqual([NO_PROMOTION_NEEDED]);
    }
  });

  it('toggles off a selected value', () => {
    expect(togglePromotion(['ads', 'email'], 'ads')).toEqual(['email']);
    expect(togglePromotion([NO_PROMOTION_NEEDED], 'email')).toEqual(['email']);
  });

  it('labels the warning actions in the spec words', () => {
    expect(NO_PROMOTION_ACTIONS).toEqual({
      someoneElse: 'Someone else is promoting it',
      ownChannel: 'Add my own channel',
      dismiss: 'No, nothing is promoting it',
    });
  });

  it('"Someone else is promoting it" replaces "No promotion needed"', () => {
    expect(promoteBySomeoneElse([NO_PROMOTION_NEEDED])).toEqual([PROMOTION_SOMEONE_ELSE]);
    expect(promoteBySomeoneElse([])).toEqual([PROMOTION_SOMEONE_ELSE]);
    expect(promoteBySomeoneElse([PROMOTION_SOMEONE_ELSE])).toEqual([PROMOTION_SOMEONE_ELSE]);
  });

  it('"Add my own channel" clears "No promotion needed" only', () => {
    expect(clearNoPromotion([NO_PROMOTION_NEEDED])).toEqual([]);
    expect(clearNoPromotion([PROMOTION_ADS])).toEqual([PROMOTION_ADS]);
  });

  it('dismissing hides the warning; it never shows when the warning does not hold', () => {
    expect(showNoPromotionWarning(true, false)).toBe(true);
    expect(showNoPromotionWarning(true, true)).toBe(false);
    expect(showNoPromotionWarning(false, false)).toBe(false);
  });

  it('starts an ongoing record with the plan-year end as its close date', () => {
    const ongoing = config({ allowedKinds: ['ongoing'] });
    expect(formStartDraft(item, ongoing, 2027).dates.close).toEqual({ value: '2027-12-31', precision: 'day' });
    expect(formStartDraft(item, config(), 2027).dates.close.value).toBeNull();
  });

  it('writes the warning body with the name and figure', () => {
    expect(noPromotionBody('Referral Push', 4000)).toBe(
      "Referral Push is projecting $4,000 with nothing promoting it. That's right for a renewal, a rebill or a " +
        'referral. But if a partner, host or affiliate is doing the promoting, pick that instead — their reach is ' +
        'what the projection should be built on.'
    );
    expect(noPromotionBody('  ', 1)).toMatch(/^This initiative is projecting \$1 /);
  });
});

describe('revenue', () => {
  it('uses lines mode only for more than one line', () => {
    expect(revenueModeFor(config())).toBe('goal');
    expect(revenueModeFor(config({ revenueLines: [line('a')] }))).toBe('goal');
    expect(revenueModeFor(TWO_LINES)).toBe('lines');
    expect(formStartDraft(item, TWO_LINES).revenue.mode).toBe('lines');
  });

  it('computes Better/Best from the goal', () => {
    const d: IntakeDraft = { ...initialDraft(item, config()), revenue: { mode: 'goal', goal: '1000', lines: {} } };
    expect(revenueView(d, config())).toEqual({ lines: null, good: 1000, better: 1100, best: 1200 });
    expect(revenueView({ ...d, revenue: { ...d.revenue, goal: null } }, config()).good).toBeNull();
  });

  it('totals the lines that read so far', () => {
    const d = formStartDraft(item, TWO_LINES);
    const partial = revenueView({ ...d, revenue: { ...d.revenue, lines: { core: '1000' } } }, TWO_LINES);
    expect(partial.lines?.map(l => [l.id, l.label, l.value])).toEqual([
      ['core', 'Core', '1000'],
      ['vip_tier', 'Vip tier', ''],
    ]);
    expect(partial.good).toBe(1000);
    const full = revenueView({ ...d, revenue: { ...d.revenue, lines: { core: '1000', vip_tier: 1000 } } }, TWO_LINES);
    expect(full).toMatchObject({ good: 2000, better: 2200, best: 2400 });
    expect(revenueView(d, TWO_LINES).good).toBeNull();
  });
});

describe('conditional block view helpers', () => {
  it('round-trips yes/no and keeps unanswered null', () => {
    expect(toYesNo(null)).toBeNull();
    expect(fromYesNo(toYesNo(true)!)).toBe(true);
    expect(fromYesNo(toYesNo(false)!)).toBe(false);
  });

  it('lists the spec options', () => {
    expect(RECRUITMENT_OPTIONS.map(o => o.label)).toEqual(['Not started', 'Recruiting', 'Confirmed']);
    expect(PROMO_SEND_OPTIONS.map(o => o.label)).toEqual(['Email', 'Social', 'Their own ad spend', "Don't know yet"]);
    expect(AD_PLATFORM_OPTIONS.map(o => o.label)).toEqual([
      'Meta',
      'Instagram Feed',
      'Instagram Reels',
      'YouTube',
      'Google',
      'Pinterest',
      'LinkedIn',
      'Other',
    ]);
    expect(COMMISSION_BASIS_OPTIONS.map(o => o.label)).toEqual(['% of revenue', 'Flat per sale']);
  });

  it('uses the reveal triggers as the promotion option values', () => {
    const values = PROMOTION_OPTIONS.map(o => o.value);
    expect(values).toContain(PROMOTION_ADS);
    expect(values).toContain(PROMOTION_SOMEONE_ELSE);
  });

  it('toggles multi-select values', () => {
    expect(toggleIn(['meta'], 'google')).toEqual(['meta', 'google']);
    expect(toggleIn(['meta', 'google'], 'meta')).toEqual(['google']);
  });

  it('labels the rate by basis and words the commission preview', () => {
    expect(commissionRateLabel('percent')).toBe('Rate (%)');
    expect(commissionRateLabel('flat')).toBe('Rate ($ per sale)');
    expect(commissionView({ status: 'off' })).toBeNull();
    expect(commissionView({ status: 'ok', good: 100, better: 110, best: 125 })).toEqual({
      good: '$100',
      better: '$110',
      best: '$125',
    });
    expect(commissionView({ status: 'needs-sales-count', message: 'm' })).toEqual({ note: 'm' });
  });
});

describe('setDatePrecision', () => {
  it('converts between day and month, keeping the month', () => {
    expect(setDatePrecision({ value: '2026-03-14', precision: 'day' }, 'month')).toEqual({
      value: '2026-03',
      precision: 'month',
    });
    expect(setDatePrecision({ value: '2026-03', precision: 'month' }, 'day')).toEqual({
      value: '2026-03-01',
      precision: 'day',
    });
    expect(setDatePrecision({ value: null, precision: 'day' }, 'month')).toEqual({ value: null, precision: 'month' });
  });

  it('is a no-op for the same precision', () => {
    const d = { value: '2026-03-14', precision: 'day' as const };
    expect(setDatePrecision(d, 'day')).toBe(d);
  });
});
