/**
 * Which schedule fields the initiative EDIT form shows, using the same rules
 * as the Add form (resolveFormLayout in intake-v3/library-config.ts).
 *
 * The Add form follows the workbook's Start Date / Event Date columns, the
 * record's allowed kinds and allowed frequencies, and its close-date wording.
 * The Edit form used to show Activation date and Event date for every
 * initiative, and had no kind or frequency at all, so a recurring initiative's
 * frequency could not be changed after it was created.
 *
 * With no library config (a custom or older initiative), every field is
 * offered, as before, plus kind and frequency.
 *
 * Pure: no React, no database.
 */
import {
  ASK_UNDECIDED,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  categoryById,
  resolveFormLayout,
  type ConversionPath,
  type InitiativeKind as FormKind,
  type LibraryRecordConfig,
  type RecurrenceFrequency,
} from '@/lib/intake-v3/library-config';
import { closeDateLabel } from '@/lib/intake-v3/universal-form';
import type { InitiativeKind as StoredKind } from '@/types';

export interface EditOption<T extends string> {
  value: T;
  label: string;
}

export interface EditLayout {
  kind: { shown: boolean; options: EditOption<StoredKind>[] };
  /** Shown only while the kind is recurring and there is more than one frequency to pick. */
  frequency: { shown: boolean; options: EditOption<RecurrenceFrequency>[]; required: boolean };
  /** A frequency the record allows only one of: written without being asked. */
  silentFrequency: RecurrenceFrequency | null;
  start: { shown: boolean; required: boolean };
  event: { shown: boolean; required: boolean };
  close: { shown: boolean; required: boolean; label: string };
}

const STORED_TO_FORM: Readonly<Record<StoredKind, FormKind>> = Object.freeze({
  'one-time': 'one-time',
  recurring: 'recurring',
  evergreen: 'ongoing',
});

const FORM_TO_STORED: Readonly<Record<FormKind, StoredKind>> = Object.freeze({
  'one-time': 'one-time',
  recurring: 'recurring',
  ongoing: 'evergreen',
});

const DEFAULT_KIND_LABELS: Readonly<Record<StoredKind, string>> = Object.freeze({
  'one-time': 'One-time',
  recurring: 'Recurring',
  evergreen: 'Ongoing',
});

export function toFormKind(kind: StoredKind | string | null | undefined): FormKind | null {
  return kind && kind in STORED_TO_FORM ? STORED_TO_FORM[kind as StoredKind] : null;
}

export function toStoredKind(kind: FormKind): StoredKind {
  return FORM_TO_STORED[kind];
}

const ALL_FREQUENCIES = (): EditOption<RecurrenceFrequency>[] =>
  RECURRENCE_FREQUENCIES.map((f) => ({ value: f, label: RECURRENCE_FREQUENCY_LABELS[f] }));

/**
 * The edit layout for an initiative of `kind`.
 *
 * `config` / `categoryId` come from the initiative's library record; either
 * missing means the generic layout. `conversionPath` is the stored path,
 * which decides the close-date wording exactly as on the Add form.
 * `hasCloseDate` keeps the close field on the generic layout for a row that
 * already carries one, so it can still be edited.
 */
export function editLayout(args: {
  config: LibraryRecordConfig | null;
  categoryId: string | null;
  kind: StoredKind | string | null | undefined;
  conversionPath?: string | null;
  hasCloseDate?: boolean;
}): EditLayout {
  const formKind = toFormKind(args.kind);
  const category = args.config ? categoryById(args.categoryId) : undefined;

  if (!args.config || !category) {
    const recurring = formKind === 'recurring';
    return {
      kind: {
        shown: true,
        options: (['one-time', 'recurring', 'evergreen'] as const).map((k) => ({ value: k, label: DEFAULT_KIND_LABELS[k] })),
      },
      frequency: { shown: recurring, options: ALL_FREQUENCIES(), required: recurring },
      silentFrequency: null,
      start: { shown: true, required: true },
      event: { shown: formKind !== 'ongoing', required: false },
      close: { shown: Boolean(args.hasCloseDate), required: false, label: 'Revenue closes' },
    };
  }

  const config = args.config;
  const path = args.conversionPath;
  const layout = resolveFormLayout({
    config,
    category,
    answers: {
      kind: formKind,
      // The stored path (or "undecided"); none stored resolves like no answer.
      conversionPath: path === ASK_UNDECIDED ? ASK_UNDECIDED : path ? (path as ConversionPath) : null,
    },
  });
  const kindShown = layout.kind.state === 'rendered';
  const recurring = layout.effectiveKind === 'recurring';
  const frequencyShown = recurring && layout.frequency.state === 'rendered';

  return {
    kind: {
      shown: kindShown,
      options: config.allowedKinds.map((k) => ({
        value: toStoredKind(k),
        label: k === 'ongoing' ? layout.ongoingLabel : DEFAULT_KIND_LABELS[toStoredKind(k)],
      })),
    },
    frequency: {
      shown: frequencyShown,
      options: config.allowedFrequencies.map((f) => ({ value: f, label: RECURRENCE_FREQUENCY_LABELS[f] })),
      required: frequencyShown,
    },
    silentFrequency: recurring && layout.frequency.state === 'suppressed' ? layout.frequency.value : null,
    start: { shown: layout.activationDate.state === 'rendered', required: true },
    event: {
      shown: layout.eventDate.state === 'rendered',
      required: layout.effectiveKind === 'one-time',
    },
    close: {
      shown: true,
      required: layout.closeDate.required,
      label: closeDateLabel(config, layout),
    },
  };
}
