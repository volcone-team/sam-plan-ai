/**
 * Pure logic behind the admin Initiative Intake configuration editor
 * (src/components/admin/initiative-config-editor.tsx).
 *
 * WHY A SEPARATE MODULE: the component is a lot of markup around a few rules
 * that are easy to get subtly wrong — which fields changed, the automatic
 * empty frequency list, which conversion paths a record can actually offer.
 * Those live here so they can be unit tested without a DOM (the repo runs
 * vitest in the node environment and has no component-rendering setup).
 *
 * NEVER DECIDES VALIDITY. That is validateLibraryConfig's job on the server,
 * run on the merged effective config. The editor only builds the patch, and
 * catches the shape mistakes parseConfigPatch would 400 on anyway, so most
 * typos are reported before a round trip.
 *
 * PURE. No React, no fetch. Imports the contract and repo types only; the repo
 * itself touches the database but nothing imported from it here does.
 */

import {
  CATEGORIES,
  CONVERSION_PATHS,
  DEFAULT_PARTNER_BLOCK,
  FIELD_EXTRA_TYPES,
  INITIATIVE_FORMATS,
  INITIATIVE_KINDS,
  MAX_FIELD_EXTRAS,
  NAMED_DATES,
  PRICE_SOURCES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  categoryById,
  isStageCategory,
  type CategoryId,
  type ConfigProblem,
  type ConversionPath,
  type FieldExtra,
  type FieldExtraType,
  type InitiativeFormat,
  type InitiativeKind,
  type NamedDate,
  type PartnerBlockConfig,
  type PriceSource,
  type RecordAudienceSource,
  type RecurrenceFrequency,
  type RevenueLine,
} from "./library-config";
import { CONFIG_FIELDS, type ConfigField, type WorkbookFlagField } from "./derive-config";
import type { ConfigPatch, ConfigStatus, FieldSource, StoredConfig } from "./config-repo";

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

export const KIND_LABEL: Readonly<Record<InitiativeKind, string>> = Object.freeze({
  "one-time": "One-time",
  recurring: "Recurring",
  ongoing: "Ongoing",
});

/** The workbook's own CTA wording, which is what the admin already knows them by. */
export const PATH_LABEL: Readonly<Record<ConversionPath, string>> = Object.freeze({
  offer: "Offer",
  calls: "Drive to calls",
  leads: "Lead collect",
  "speaker-fee": "Speaker fee",
});

export const FREQUENCY_LABEL: Readonly<Record<RecurrenceFrequency, string>> = RECURRENCE_FREQUENCY_LABELS;

export const FORMAT_LABEL: Readonly<Record<InitiativeFormat, string>> = Object.freeze({
  "in-person": "In person",
  digital: "Digital",
  hybrid: "Hybrid",
});

export const AUDIENCE_LABEL: Readonly<Record<RecordAudienceSource, string>> = Object.freeze({
  own: "Your audience",
  borrowed: "Someone else's audience",
});

export const PRICE_SOURCE_LABEL: Readonly<Record<PriceSource, string>> = Object.freeze({
  "product.price": "Linked product's price",
  "attrs.entry_price": "Entry price (answered on the initiative)",
  host_fee: "Host fee",
});

export const NAMED_DATE_LABEL: Readonly<Record<NamedDate, string>> = Object.freeze({
  registration_opens: "Registration opens",
  registration_closes: "Registration closes",
  cart_opens: "Cart opens",
  cart_closes: "Cart closes",
  event_date: "Event date",
  close_date: "Close date",
  contract_terms: "Contract terms",
});

export const SOURCE_LABEL: Readonly<Record<FieldSource, string>> = Object.freeze({
  saved: "Saved",
  derived: "From workbook",
  unset: "Not set",
});

export const STATUS_LABEL: Readonly<Record<ConfigStatus["status"], string>> = Object.freeze({
  valid: "Valid",
  invalid: "Invalid",
  incomplete: "Incomplete",
});

export const FIELD_LABEL: Readonly<Record<ConfigField, string>> = Object.freeze({
  categoryId: "Category",
  audienceSource: "Audience",
  // Admin-facing names follow the workbook columns ("Frequency",
  // "Allowed Frequencies"); the code identifiers and DB columns keep their names.
  allowedKinds: "Frequency",
  allowedPaths: "Allowed conversion paths",
  allowedFrequencies: "Allowed frequency",
  formatOverride: "Format override",
  ongoingLabel: "Ongoing label",
  partnerBlock: "Partner block",
  revenueLines: "Revenue lines",
  fieldExtras: "Field extras",
});

/** The same, as it reads mid-sentence: "87 still need a frequency". */
const FIELD_PHRASE: Readonly<Record<ConfigField, string>> = Object.freeze({
  categoryId: "a category",
  audienceSource: "an audience",
  allowedKinds: "a frequency",
  allowedPaths: "allowed conversion paths",
  allowedFrequencies: "an allowed frequency",
  formatOverride: "a format override",
  ongoingLabel: "an ongoing label",
  partnerBlock: "a partner block",
  revenueLines: "revenue lines",
  fieldExtras: "field extras",
});

/**
 * The two read-only date flags, named after their workbook columns. Not
 * ConfigFields: they come only from the workbook and cannot be edited here.
 */
export const WORKBOOK_FLAG_LABEL: Readonly<Record<WorkbookFlagField, string>> = Object.freeze({
  askStartDate: "Start date",
  askEventDate: "Event date",
});

/** Label for a field name that may not be a ConfigField (problems carry plain strings). */
export function fieldLabel(field: string): string {
  return (
    (FIELD_LABEL as Record<string, string>)[field] ??
    (WORKBOOK_FLAG_LABEL as Record<string, string>)[field] ??
    field
  );
}

/**
 * "Start date: asked (from workbook)" / "Event date: not asked (from workbook)".
 * Unset reads as asked — the form's behaviour — and says the workbook is silent.
 */
export function workbookFlagLine(field: WorkbookFlagField, value: boolean | undefined): string {
  const label = WORKBOOK_FLAG_LABEL[field];
  if (value === false) return `${label}: not asked (from workbook)`;
  if (value === true) return `${label}: asked (from workbook)`;
  return `${label}: asked (workbook cell blank or not read)`;
}

/** One line per field that still needs a human, CONFIG_FIELDS order, zeros dropped. */
export function needsHumanLines(
  counts: Readonly<Partial<Record<ConfigField, number>>>
): { field: ConfigField; count: number; text: string }[] {
  return CONFIG_FIELDS.filter((f) => (counts[f] ?? 0) > 0).map((f) => ({
    field: f,
    count: counts[f]!,
    text: `${counts[f]} still need ${FIELD_PHRASE[f]}`,
  }));
}

/* ------------------------------------------------------------------ *
 * The draft: what the form holds
 * ------------------------------------------------------------------ */

export interface RevenueLineDraft {
  id: string;
  priceSource: PriceSource;
  windowOpens: NamedDate;
  windowCloses: NamedDate;
  /** "" = no condition. */
  condition: string;
}

export interface FieldExtraDraft {
  key: string;
  label: string;
  readBy: string;
  /** Absent = text, as in FieldExtra. */
  type?: FieldExtraType;
  hint?: string;
  /** Carried through unedited: the editor does not expose links. */
  binds?: FieldExtra["binds"];
  derives?: FieldExtra["derives"];
}

/**
 * Form-friendly view of one record's effective config.
 *
 * `null` ON THE ARRAY FIELDS MEANS "NOT SET", never "none". The repo keeps that
 * distinction (a NULL column is "nobody has decided"), so the editor must too:
 * collapsing it to [] would save "this record offers nothing" on every field
 * the admin merely looked at. Scalars use "" for unset because that is what a
 * <select> holds.
 */
export interface EditorDraft {
  categoryId: CategoryId | "";
  audienceSource: RecordAudienceSource | "";
  allowedKinds: InitiativeKind[] | null;
  allowedPaths: ConversionPath[] | null;
  allowedFrequencies: RecurrenceFrequency[] | null;
  formatOverride: InitiativeFormat | "";
  ongoingLabel: string;
  partnerBlock: PartnerBlockConfig;
  revenueLines: RevenueLineDraft[] | null;
  fieldExtras: FieldExtraDraft[] | null;
}

const inVocabOrder = <T extends string>(vocab: readonly T[], values: readonly T[]): T[] =>
  vocab.filter((v) => values.includes(v));

/** Draft from a record's effective config (saved over derived). */
export function draftFromConfig(config: StoredConfig): EditorDraft {
  return {
    categoryId: categoryById(config.categoryId)?.id ?? "",
    audienceSource: config.audienceSource ?? "",
    allowedKinds: config.allowedKinds ? inVocabOrder(INITIATIVE_KINDS, config.allowedKinds) : null,
    allowedPaths: config.allowedPaths ? inVocabOrder(CONVERSION_PATHS, config.allowedPaths) : null,
    allowedFrequencies: config.allowedFrequencies
      ? inVocabOrder(RECURRENCE_FREQUENCIES, config.allowedFrequencies)
      : null,
    formatOverride: config.formatOverride ?? "",
    ongoingLabel: config.ongoingLabel ?? "",
    partnerBlock: { ...(config.partnerBlock ?? DEFAULT_PARTNER_BLOCK) },
    revenueLines: config.revenueLines
      ? config.revenueLines.map((l) => ({
          id: l.id,
          priceSource: l.priceSource,
          windowOpens: l.windowOpens,
          windowCloses: l.windowCloses,
          condition: l.condition ?? "",
        }))
      : null,
    fieldExtras: config.fieldExtras ? config.fieldExtras.map((e) => ({ ...e })) : null,
  };
}

/** Is `recurring` among the allowed kinds? Unset kinds allow nothing yet. */
export const recurringAllowed = (d: Pick<EditorDraft, "allowedKinds">): boolean =>
  d.allowedKinds?.includes("recurring") ?? false;

export const ongoingAllowed = (d: Pick<EditorDraft, "allowedKinds">): boolean =>
  d.allowedKinds?.includes("ongoing") ?? false;

/**
 * The draft as it will be saved, after the two kind-driven rules.
 *
 * THE AUTOMATIC EMPTY FREQUENCY LIST. The repo treats `allowedFrequencies` as
 * required for completeness, but only a recurring record has any — and
 * validateLibraryConfig REFUSES frequencies on a record that cannot recur
 * (`frequencies_without_recurring`). So once kinds are decided and recurring
 * is not among them, the only correct value is [], and making the admin tick
 * "none" on 60-odd one-time records would be busywork that a forgotten click
 * turns into an incomplete record. The frequency checkboxes are disabled in
 * that state, so the admin could not set it any other way anyway.
 *
 * Only when kinds ARE decided: with kinds unset nobody has said the record
 * does not recur, and [] would be a decision made on their behalf.
 *
 * The ongoing label follows the same logic for the same reason
 * (`ongoing_label_without_ongoing`): its input is disabled when ongoing is not
 * allowed, so a stale value there would be a 422 the admin cannot fix.
 *
 * The raw draft is NOT changed: re-ticking recurring brings back what the
 * admin had chosen.
 */
export function normalizeDraft(d: EditorDraft): EditorDraft {
  if (d.allowedKinds === null) return d;
  return {
    ...d,
    allowedFrequencies: recurringAllowed(d) ? d.allowedFrequencies : [],
    ongoingLabel: ongoingAllowed(d) ? d.ongoingLabel : "",
  };
}

const sameSet = <T>(a: readonly T[] | null, b: readonly T[] | null): boolean =>
  a === null || b === null
    ? a === b
    : a.length === b.length && a.every((x) => b.includes(x));

function cleanLines(lines: readonly RevenueLineDraft[] | null): RevenueLine[] | null {
  if (lines === null) return null;
  return lines.map((l) => {
    const condition = l.condition.trim();
    return {
      id: l.id.trim(),
      priceSource: l.priceSource,
      windowOpens: l.windowOpens,
      windowCloses: l.windowCloses,
      ...(condition ? { condition } : {}),
    };
  });
}

function cleanExtras(extras: readonly FieldExtraDraft[] | null): FieldExtra[] | null {
  if (extras === null) return null;
  return extras.map((e) => {
    const hint = e.hint?.trim() ?? "";
    return {
      key: e.key.trim(),
      label: e.label.trim(),
      readBy: e.readBy.trim(),
      // "text" is the absent default; writing it would make an untouched
      // pre-type extra look changed.
      ...(e.type && e.type !== "text" ? { type: e.type } : {}),
      ...(hint ? { hint } : {}),
      ...(e.binds ? { binds: e.binds } : {}),
      ...(e.derives ? { derives: e.derives } : {}),
    };
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PUT patch: only the fields whose saved value would change.
 *
 * ONLY CHANGED FIELDS, because the server merges the patch over the saved row
 * (or over the derived one when there is no row). Sending everything would
 * turn every "From workbook" value into a "Saved" one the admin never
 * confirmed, and the needs-human counts would lie.
 *
 * `original` is the draft built from the effective config, un-normalised: a
 * one-time record whose frequencies are unset therefore DOES produce
 * `allowedFrequencies: []` — that is the point of the rule.
 */
export function buildPatch(original: EditorDraft, edited: EditorDraft): ConfigPatch {
  const e = normalizeDraft(edited);
  const o = original;
  const patch: ConfigPatch = {};

  if (e.categoryId !== o.categoryId) patch.categoryId = e.categoryId || null;
  if (e.audienceSource !== o.audienceSource) patch.audienceSource = e.audienceSource || null;
  if (!sameSet(o.allowedKinds, e.allowedKinds)) {
    patch.allowedKinds = e.allowedKinds ? inVocabOrder(INITIATIVE_KINDS, e.allowedKinds) : null;
  }
  if (!sameSet(o.allowedPaths, e.allowedPaths)) {
    patch.allowedPaths = e.allowedPaths ? inVocabOrder(CONVERSION_PATHS, e.allowedPaths) : null;
  }
  if (!sameSet(o.allowedFrequencies, e.allowedFrequencies)) {
    patch.allowedFrequencies = e.allowedFrequencies
      ? inVocabOrder(RECURRENCE_FREQUENCIES, e.allowedFrequencies)
      : null;
  }
  if (e.formatOverride !== o.formatOverride) patch.formatOverride = e.formatOverride || null;

  const label = e.ongoingLabel.trim();
  if (label !== o.ongoingLabel.trim()) patch.ongoingLabel = label || null;

  if (e.partnerBlock.host !== o.partnerBlock.host || e.partnerBlock.booking !== o.partnerBlock.booking) {
    patch.partnerBlock = { host: e.partnerBlock.host, booking: e.partnerBlock.booking };
  }

  const lines = cleanLines(e.revenueLines);
  if (!sameJson(lines, cleanLines(o.revenueLines))) patch.revenueLines = lines;

  const extras = cleanExtras(e.fieldExtras);
  if (!sameJson(extras, cleanExtras(o.fieldExtras))) patch.fieldExtras = extras;

  return patch;
}

/** Fields the patch would touch, for "unsaved changes" markers. */
export function changedFields(original: EditorDraft, edited: EditorDraft): Set<ConfigField> {
  return new Set(Object.keys(buildPatch(original, edited)) as ConfigField[]);
}

/**
 * Shape mistakes parseConfigPatch would refuse with a 400, caught locally so
 * they can sit next to the field. Coherence (leads on own audience, impossible
 * windows) is left to the server: duplicating validateLibraryConfig here is
 * how the two would drift apart.
 */
export function draftErrors(d: EditorDraft): Partial<Record<ConfigField, string>> {
  const errors: Partial<Record<ConfigField, string>> = {};
  if (d.revenueLines?.some((l) => l.id.trim() === "")) {
    errors.revenueLines = "Every revenue line needs an id.";
  }
  if (d.fieldExtras) {
    if (d.fieldExtras.length > MAX_FIELD_EXTRAS) {
      errors.fieldExtras = `At most ${MAX_FIELD_EXTRAS} extra fields.`;
    } else if (d.fieldExtras.some((x) => !x.key.trim() || !x.label.trim() || !x.readBy.trim())) {
      errors.fieldExtras = "Every extra needs a key, a label and what reads it.";
    }
  }
  if (d.ongoingLabel.trim().length > 60) {
    errors.ongoingLabel = "At most 60 characters.";
  }
  return errors;
}

/**
 * 422 problems grouped by the editor field they belong to.
 *
 * Problems on revenue windows carry `revenueLines.<id>.windowOpens`; the
 * repeater shows them all, so they group under `revenueLines`. Anything not
 * an editor field (e.g. `initiativeKey`) goes under `_form`.
 */
export function groupProblems(problems: readonly ConfigProblem[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const p of problems) {
    const top = p.field.split(".")[0];
    const key = (CONFIG_FIELDS as readonly string[]).includes(top) ? top : "_form";
    (grouped[key] ??= []).push(p.message);
  }
  return grouped;
}

/* ------------------------------------------------------------------ *
 * Conversion path availability
 * ------------------------------------------------------------------ */

/**
 * Why a path would be filtered out of the customer's options, or null.
 *
 * The same rule as availableConversionPaths (asserted equal in the tests),
 * restated per path so the editor can explain each greyed option. Returns
 * null when the deciding field is not set yet: "speaker fee needs a stage
 * category" is not a restriction until a category has been chosen.
 *
 * `leads` is no longer audience-restricted (the owner's designs offer it on
 * own-audience categories); `_audience` is kept so callers need not change.
 */
export function pathRestriction(
  path: ConversionPath,
  _audience: RecordAudienceSource | "",
  categoryId: CategoryId | ""
): string | null {
  if (path === "speaker-fee" && categoryId !== "" && !isStageCategory(categoryId)) {
    return "Only offered in an Other People's Stages category.";
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Repeater defaults
 * ------------------------------------------------------------------ */

/**
 * A new revenue line. `close_date` for both edges because it is the one named
 * date every record has (see availableNamedDates), so a fresh line is never
 * born invalid; the admin then picks the real window.
 */
export function newRevenueLine(existing: readonly RevenueLineDraft[]): RevenueLineDraft {
  const ids = new Set(existing.map((l) => l.id));
  let n = existing.length + 1;
  while (ids.has(`line-${n}`)) n += 1;
  return {
    id: `line-${n}`,
    priceSource: PRICE_SOURCES[0],
    windowOpens: "close_date",
    windowCloses: "close_date",
    condition: "",
  };
}

export const newFieldExtra = (): FieldExtraDraft => ({ key: "", label: "", readBy: "" });

export const canAddExtra = (extras: readonly FieldExtraDraft[] | null): boolean =>
  (extras?.length ?? 0) < MAX_FIELD_EXTRAS;

/* ------------------------------------------------------------------ *
 * List filtering
 * ------------------------------------------------------------------ */

/** The minimum of a LibraryConfigRecord the list filter reads. */
export interface FilterableRecord {
  initiativeKey: string;
  library: { name: string | null };
  effective: { categoryId?: CategoryId };
  validation: { status: ConfigStatus["status"] };
}

export type CategoryFilter = "all" | "none" | CategoryId;
export type StatusFilter = "all" | ConfigStatus["status"];

export interface RecordFilters {
  category: CategoryFilter;
  status: StatusFilter;
  query: string;
}

export const DEFAULT_FILTERS: Readonly<RecordFilters> = Object.freeze({
  category: "all",
  status: "all",
  query: "",
});

/**
 * Category, status and a case-insensitive search on the name. The key is
 * searched too: three library records are called "Hybrid Events", and the key
 * is the only thing that tells them apart.
 */
export function filterRecords<T extends FilterableRecord>(
  records: readonly T[],
  filters: RecordFilters
): T[] {
  const q = filters.query.trim().toLowerCase();
  return records.filter((r) => {
    if (filters.category === "none" && r.effective.categoryId) return false;
    if (
      filters.category !== "all" &&
      filters.category !== "none" &&
      r.effective.categoryId !== filters.category
    ) {
      return false;
    }
    if (filters.status !== "all" && r.validation.status !== filters.status) return false;
    if (q) {
      const name = (r.library.name ?? "").toLowerCase();
      if (!name.includes(q) && !r.initiativeKey.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/** The twelve, for the category <select>s, in the spec's picker order. */
export const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ id: c.id, label: c.label }));

/** Re-exported so the component has one import for the vocabularies it lists. */
export { CONVERSION_PATHS, FIELD_EXTRA_TYPES, INITIATIVE_FORMATS, INITIATIVE_KINDS, NAMED_DATES, PRICE_SOURCES, RECURRENCE_FREQUENCIES };
