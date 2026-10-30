/**
 * View logic for the universal initiative form (intake-form.tsx): option
 * lists, labels, money copy and small draft transforms.
 *
 * NO LAYOUT RULES HERE. What renders is `layoutFor` (library-config.ts via
 * universal-form.ts); this module only turns the layout's answers into words
 * and options. Pure, so it can be unit-tested without React.
 */

import { formatMoney } from '@/lib/format-money';
import {
  ASK_UNDECIDED,
  INITIATIVE_FORMATS,
  RECURRENCE_FREQUENCY_LABELS,
  offersAskUndecided,
  type AskUndecided,
  type CategoryId,
  type ConversionPath,
  type FormLayout,
  type InitiativeFormat,
  type InitiativeKind,
  type LibraryRecordConfig,
  type RecurrenceFrequency,
} from '@/lib/intake-v3/library-config';
import { goalScenarios } from '@/lib/intake-v3/revenue';
import {
  NO_PROMOTION_NEEDED,
  PROMOTION_ADS,
  PROMOTION_SOMEONE_ELSE,
  initialDraft,
  revenueLineIds,
  withOngoingCloseDefault,
  withRecurringLastDefault,
  type AdPlatform,
  type BookingStatus,
  type CommissionBasis,
  type CommissionPreview,
  type DraftDate,
  type IntakeDraft,
  type PromoSend,
  type RecruitmentStatus,
  type RevenueMode,
} from '@/lib/intake-v3/universal-form';
import type { PickerItem } from '@/lib/intake-v3/picker';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** A line under the label, e.g. what a kind means. */
  description?: string;
}

/* ------------------------------------------------------------------ *
 * Labels and options
 * ------------------------------------------------------------------ */

export const CONVERSION_PATH_LABELS: Readonly<Record<ConversionPath | AskUndecided, string>> = Object.freeze({
  offer: 'Make an offer',
  calls: 'Drive to calls',
  leads: 'Collect leads',
  'speaker-fee': 'Speaker fee',
  [ASK_UNDECIDED]: "I don't know yet",
});

export const FORMAT_LABELS: Readonly<Record<InitiativeFormat, string>> = Object.freeze({
  'in-person': 'In-person',
  digital: 'Digital',
  hybrid: 'Hybrid',
});

export const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = RECURRENCE_FREQUENCY_LABELS;

/** The word for a kind; `ongoing` uses the record's own word (layout.ongoingLabel). */
export function kindLabel(kind: InitiativeKind, ongoingLabel: string): string {
  if (kind === 'ongoing') return ongoingLabel;
  return kind === 'one-time' ? 'One-time' : 'Recurring';
}

/** The line under each kind option. The ongoing one is shown under the record's own word. */
export const KIND_DESCRIPTIONS: Readonly<Record<InitiativeKind, string>> = Object.freeze({
  'one-time': 'A single dated promo with an event.',
  recurring: 'A schedule that spawns instances.',
  ongoing: 'Always on, no event date.',
});

export function kindOptions(
  config: Pick<LibraryRecordConfig, 'allowedKinds'>,
  layout: Pick<FormLayout, 'ongoingLabel'>
): Option<InitiativeKind>[] {
  return config.allowedKinds.map(k => ({
    value: k,
    label: kindLabel(k, layout.ongoingLabel),
    description: KIND_DESCRIPTIONS[k],
  }));
}

/** The layout's available paths, plus "I don't know yet" where the category offers it. */
export function pathOptions(
  layout: Pick<FormLayout, 'availablePaths'>,
  categoryId: CategoryId
): Option<ConversionPath | AskUndecided>[] {
  const options: Option<ConversionPath | AskUndecided>[] = layout.availablePaths.map(p => ({
    value: p,
    label: CONVERSION_PATH_LABELS[p],
  }));
  if (offersAskUndecided(categoryId)) {
    options.push({ value: ASK_UNDECIDED, label: CONVERSION_PATH_LABELS[ASK_UNDECIDED] });
  }
  return options;
}

export const FORMAT_OPTIONS: readonly Option<InitiativeFormat>[] = Object.freeze(
  INITIATIVE_FORMATS.map(f => ({ value: f, label: FORMAT_LABELS[f] }))
);

export function frequencyOptions(
  config: Pick<LibraryRecordConfig, 'allowedFrequencies'>
): Option<RecurrenceFrequency>[] {
  return config.allowedFrequencies.map(f => ({ value: f, label: FREQUENCY_LABELS[f] }));
}

export const BOOKING_OPTIONS: readonly Option<BookingStatus>[] = Object.freeze([
  { value: 'confirmed', label: "Yes, it's booked" },
  { value: 'pending', label: 'Not yet' },
]);

/** The helper under "Is it booked?", naming the partner when one is entered. */
export function bookingHelp(host: string | null | undefined): string {
  const name = host?.trim() || 'your partner';
  return `Booked means you have the date in writing from ${name}. A verbal yes isn't booked.`;
}

/* ------------------------------------------------------------------ *
 * Promotion
 * ------------------------------------------------------------------ */

export const PROMOTION_OPTIONS: readonly Option<string>[] = Object.freeze([
  { value: PROMOTION_ADS, label: 'Ads' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'organic-social', label: 'Organic Social' },
  { value: PROMOTION_SOMEONE_ELSE, label: 'Someone else is promoting it' },
  { value: 'other', label: 'Other' },
  { value: NO_PROMOTION_NEEDED, label: 'No promotion needed' },
]);

/**
 * Toggle one promotion choice. "No promotion needed" is exclusive: picking it
 * clears the others, and picking anything else clears it.
 */
export function togglePromotion(current: readonly string[], value: string): string[] {
  if (current.includes(value)) return current.filter(v => v !== value);
  if (value === NO_PROMOTION_NEEDED) return [value];
  return [...current.filter(v => v !== NO_PROMOTION_NEEDED), value];
}

/** The no-promotion warning's three actions, in the spec's words. */
export const NO_PROMOTION_ACTIONS = Object.freeze({
  /** Primary: selects "Someone else is promoting it". */
  someoneElse: 'Someone else is promoting it',
  /** Secondary: focuses the channel chips. */
  ownChannel: 'Add my own channel',
  /** Link: hides the warning for this draft; the answer stays. */
  dismiss: 'No, nothing is promoting it',
});

/** "Someone else is promoting it": select it, replacing "No promotion needed". */
export function promoteBySomeoneElse(current: readonly string[]): string[] {
  const rest = current.filter(v => v !== NO_PROMOTION_NEEDED);
  return rest.includes(PROMOTION_SOMEONE_ELSE) ? rest : [...rest, PROMOTION_SOMEONE_ELSE];
}

/** "Add my own channel": clear "No promotion needed" so a channel can be picked. */
export function clearNoPromotion(current: readonly string[]): string[] {
  return current.filter(v => v !== NO_PROMOTION_NEEDED);
}

/**
 * Show the no-promotion warning? Only while the warning holds and the user has
 * not dismissed it for this draft. Never blocks saving either way.
 */
export function showNoPromotionWarning(warningHolds: boolean, dismissed: boolean): boolean {
  return warningHolds && !dismissed;
}

/** The no-promotion warning's body. `good` is the projected Good figure. */
export function noPromotionBody(name: string, good: number): string {
  const who = name.trim() || 'This initiative';
  return (
    `${who} is projecting ${formatMoney(good)} with nothing promoting it. ` +
    "That's right for a renewal, a rebill or a referral. But if a partner, host or affiliate is doing " +
    'the promoting, pick that instead — their reach is what the projection should be built on.'
  );
}

/* ------------------------------------------------------------------ *
 * Conditional blocks
 * ------------------------------------------------------------------ */

export type YesNo = 'yes' | 'no';

export const YES_NO_OPTIONS: readonly Option<YesNo>[] = Object.freeze([
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]);

/** A draft boolean as a radio value, and back. Null stays unanswered. */
export const toYesNo = (v: boolean | null): YesNo | null => (v === null ? null : v ? 'yes' : 'no');
export const fromYesNo = (v: YesNo): boolean => v === 'yes';

export const RECRUITMENT_OPTIONS: readonly Option<RecruitmentStatus>[] = Object.freeze([
  { value: 'not-started', label: 'Not started' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'confirmed', label: 'Confirmed' },
]);

export const PROMO_SEND_OPTIONS: readonly Option<PromoSend>[] = Object.freeze([
  { value: 'email', label: 'Email' },
  { value: 'social', label: 'Social' },
  { value: 'own-ad-spend', label: 'Their own ad spend' },
  { value: 'dont-know', label: "Don't know yet" },
]);

export const AD_PLATFORM_OPTIONS: readonly Option<AdPlatform>[] = Object.freeze([
  { value: 'meta', label: 'Meta' },
  { value: 'instagram-feed', label: 'Instagram Feed' },
  { value: 'instagram-reels', label: 'Instagram Reels' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'google', label: 'Google' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'other', label: 'Other' },
]);

export const COMMISSION_BASIS_OPTIONS: readonly Option<CommissionBasis>[] = Object.freeze([
  { value: 'percent', label: '% of revenue' },
  { value: 'flat', label: 'Flat per sale' },
]);

/** The rate field's label, which depends on the basis. */
export function commissionRateLabel(basis: CommissionBasis | null): string {
  return basis === 'flat' ? 'Rate ($ per sale)' : basis === 'percent' ? 'Rate (%)' : 'Rate';
}

/** Toggle a value in a multi-select list, keeping the list's order. */
export function toggleIn<T extends string>(current: readonly T[], value: T): T[] {
  return current.includes(value) ? current.filter(v => v !== value) : [...current, value];
}

/** Display string for a draft number input. */
export const amountInput = (v: number | string | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

/** What the commission line says, or null when there is nothing to show. */
export function commissionView(
  preview: CommissionPreview
): { note: string } | { good: string; better: string; best: string } | null {
  switch (preview.status) {
    case 'off':
      return null;
    case 'no-revenue':
      return { note: 'Commission is calculated once there is a revenue goal.' };
    case 'needs-sales-count':
      return { note: preview.message };
    case 'ok':
      return { good: formatMoney(preview.good), better: formatMoney(preview.better), best: formatMoney(preview.best) };
  }
}

/* ------------------------------------------------------------------ *
 * Revenue
 * ------------------------------------------------------------------ */

/** Per-line answers only when the record declares more than one line. */
export function revenueModeFor(config: Pick<LibraryRecordConfig, 'revenueLines'>): RevenueMode {
  return config.revenueLines.length > 1 ? 'lines' : 'goal';
}

/** "vip_tier" -> "Vip tier". Revenue lines carry an id, not a label. */
export function revenueLineLabel(id: string): string {
  const words = id.replace(/[-_.]+/g, ' ').trim();
  if (words === '') return 'Revenue';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Display string for a figure, or an em dash when it is not known yet. */
export const moneyOrDash = (value: number | null): string => (value === null ? '—' : formatMoney(value));

export interface RevenueView {
  /** Per-line rows in `lines` mode, else null. */
  lines: { id: string; label: string; value: string }[] | null;
  /** Good, Better, Best; null where the answer does not read yet. */
  good: number | null;
  better: number | null;
  best: number | null;
}

const asInput = (v: number | string | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

/**
 * What the revenue section shows. In `lines` mode the total sums the lines
 * that read so far, so it updates as each one is filled; Better/Best of that
 * total come from goalScenarios, the same arithmetic the request uses.
 */
export function revenueView(draft: IntakeDraft, config: Pick<LibraryRecordConfig, 'revenueLines'>): RevenueView {
  if (draft.revenue.mode === 'goal') {
    const g = goalScenarios(draft.revenue.goal);
    return g.ok
      ? { lines: null, ...g.scenarios }
      : { lines: null, good: null, better: null, best: null };
  }
  const ids = revenueLineIds(config);
  let total = 0;
  let any = false;
  const lines = ids.map(id => {
    const g = goalScenarios(draft.revenue.lines[id]);
    if (g.ok) {
      total += g.scenarios.good;
      any = true;
    }
    return { id, label: revenueLineLabel(id), value: asInput(draft.revenue.lines[id]) };
  });
  if (!any) return { lines, good: null, better: null, best: null };
  const t = goalScenarios(total);
  return t.ok ? { lines, ...t.scenarios } : { lines, good: null, better: null, best: null };
}

/* ------------------------------------------------------------------ *
 * Draft helpers
 * ------------------------------------------------------------------ */

/**
 * The form's starting draft: initialDraft, with the revenue mode the record
 * needs, and (for an ongoing record) the close date at the plan-year end.
 */
export function formStartDraft(
  item: PickerItem,
  config: LibraryRecordConfig,
  planYear?: number | null
): IntakeDraft {
  const draft = initialDraft(item, config);
  return withRecurringLastDefault(
    withOngoingCloseDefault(
      { ...draft, revenue: { ...draft.revenue, mode: revenueModeFor(config) } },
      config,
      planYear
    ),
    config,
    planYear
  );
}

/**
 * Switch a date between day and month precision, keeping what was entered:
 * a day becomes its month; a month becomes the 1st of it.
 */
export function setDatePrecision(date: DraftDate, precision: DraftDate['precision']): DraftDate {
  if (date.precision === precision) return date;
  const v = date.value?.trim() ?? '';
  if (v === '') return { value: null, precision };
  if (precision === 'month') {
    const m = /^(\d{4}-\d{2})/.exec(v);
    return { value: m ? m[1] : null, precision };
  }
  const m = /^(\d{4}-\d{2})(?:-(\d{2}))?$/.exec(v);
  return { value: m ? `${m[1]}-${m[2] ?? '01'}` : null, precision };
}

/** A DOM id for a draft field key ("dates.close" -> "<base>-dates-close"). */
export function fieldDomId(base: string, key: string): string {
  return `${base}-${key.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/** The DOM id of a field's error message. */
export const errorDomId = (base: string, key: string): string => `${fieldDomId(base, key)}-error`;

/**
 * The notice shown just above the submit button when a save was refused.
 *
 * On a long form the field errors and the summary at the top are off-screen
 * when the user clicks, so the button looked like it did nothing (client,
 * Oct 2026). Null when there is nothing to say.
 */
export function submitBlockedNotice(errorCount: number): string | null {
  if (!Number.isFinite(errorCount) || errorCount <= 0) return null;
  return errorCount === 1
    ? 'One field needs attention. Scroll up to fix it, then try again.'
    : `${errorCount} fields need attention. Scroll up to fix them, then try again.`;
}
