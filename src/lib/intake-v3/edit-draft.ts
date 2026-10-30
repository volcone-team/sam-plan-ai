/**
 * EDIT WITH THE ADD FORM (client, Oct 2026: "the edit form should be exactly
 * the same as the Add Initiative form").
 *
 * Two pure pieces:
 *   - `draftFromInitiative`: a saved initiative back into the IntakeDraft the
 *     Add form edits. It is the reverse of `buildCreateRequest`, read key for
 *     key, so opening and saving without a change writes the same answers.
 *   - `mergeEditedAttrs`: the saved row's attrs with the form's own keys
 *     replaced by the edited answers. Keys the form does not own (moved
 *     occurrences, the 061 fallbacks, anything written elsewhere) are kept.
 *
 * PURE. No React, no database, no network.
 */
import type { InitiativeKind as StoredKind } from "@/types";
import { toDateOnly } from "@/lib/plan-dates";
import {
  ASK_UNDECIDED,
  INITIATIVE_FORMATS,
  RECURRENCE_FREQUENCIES,
  fieldExtraType,
  type CategoryId,
  type ConversionPath,
  type InitiativeFormat,
  type InitiativeKind,
  type LibraryRecordConfig,
  type RecordAudienceSource,
  type RecurrenceFrequency,
} from "./library-config";
import { autoBest, autoBetter } from "./revenue";
import type { PickerItem } from "./picker";
import { allSchemaFields, schemaFor } from "./category-schemas";
import {
  AD_PLATFORMS,
  BOOKING_STATUSES,
  COMMISSION_BASES,
  NO_PROMOTION_ATTR,
  PROMO_SENDS,
  RECRUITMENT_STATUSES,
  initialDraft,
  ownExtras,
  withOngoingCloseDefault,
  withRecurringLastDefault,
  type AdPlatform,
  type BookingStatus,
  type CommissionBasis,
  type DraftDate,
  type IntakeDraft,
  type PromoSend,
  type RecruitmentStatus,
} from "./universal-form";
import { LEAD_GOAL_ATTR, LEAD_HANDOFF_ATTR } from "../initiatives/lead-handoff";
import { lastOccurrenceOf, type OccurrenceFields } from "../initiatives/occurrences";
import { perRun } from "../planning/revenue-spread";

type DateLike = Date | string | null | undefined;
type Row = Record<string, unknown>;

/** What the edit form reads from a saved initiative. */
export interface EditSource extends OccurrenceFields {
  name: string;
  description?: string | null;
  kind: StoredKind;
  conversionPath?: string | null;
  format?: string | null;
  categoryId?: string | null;
  audienceSource?: string | null;
  repeatFrequency?: string | null;
  activationDate?: DateLike;
  activationDatePrecision?: "day" | "month";
  eventDate?: DateLike;
  eventDatePrecision?: "day" | "month";
  revenueCloseDate?: DateLike;
  revenueScenarios?: { good?: number | null; better?: number | null; best?: number | null } | null;
  productId?: string | null;
  plannedBudget?: number | null;
  attrs?: Readonly<Row> | null;
}

const isObject = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const amount = (v: unknown): number | string | null => {
  const n = num(v);
  return n === null ? null : n;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
const someOf = <T extends string>(list: readonly T[], v: unknown): T[] =>
  Array.isArray(v) ? list.filter((x) => v.includes(x)) : [];

/** A stored date as the form holds it: YYYY-MM-DD, or YYYY-MM for month precision. */
function draftDate(v: DateLike, precision: unknown): DraftDate {
  if (v === null || v === undefined || v === "") return { value: null, precision: "day" };
  const s = toDateOnly(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { value: null, precision: "day" };
  return precision === "month" ? { value: s.slice(0, 7), precision: "month" } : { value: s, precision: "day" };
}

const STORED_TO_FORM_KIND: Readonly<Record<string, InitiativeKind>> = Object.freeze({
  "one-time": "one-time",
  recurring: "recurring",
  evergreen: "ongoing",
});

/** A typed Better / Best, or null when it equals the suggestion (Good +10% / +20%). */
function typedOver(value: number, suggested: number): number | null {
  return Math.abs(value - suggested) < 0.5 ? null : Math.round(value * 100) / 100;
}

/**
 * The Add form's draft for a saved initiative.
 *
 * Starts from `initialDraft` (so every field has its shape and the layout's
 * silent values), then fills each answer from the column or attrs key that
 * `buildCreateRequest` writes it to. A recurring initiative's revenue is read
 * back PER OCCURRENCE, because that is what the form asks for.
 */
export function draftFromInitiative(
  source: EditSource,
  item: PickerItem,
  config: LibraryRecordConfig,
  planYear: number | null = null
): IntakeDraft {
  // Older rows have no last occurrence (or ongoing close): the Add form's
  // defaults fill them, exactly as it would for a new initiative.
  return withRecurringLastDefault(
    withOngoingCloseDefault(readDraft(source, item, config), config, planYear),
    config,
    planYear
  );
}

function readDraft(source: EditSource, item: PickerItem, config: LibraryRecordConfig): IntakeDraft {
  const base = initialDraft(item, config);
  const a: Row = isObject(source.attrs) ? source.attrs : {};

  const kind = STORED_TO_FORM_KIND[source.kind] ?? base.kind;
  const conversionPath =
    a.conversion_ask === ASK_UNDECIDED
      ? ASK_UNDECIDED
      : (str(source.conversionPath) as ConversionPath | null) ?? base.conversionPath;
  const format = oneOf<InitiativeFormat>(INITIATIVE_FORMATS, source.format) ?? base.format;
  const frequency =
    oneOf<RecurrenceFrequency>(RECURRENCE_FREQUENCIES, source.repeatFrequency) ??
    oneOf<RecurrenceFrequency>(RECURRENCE_FREQUENCIES, a.repeat_frequency) ??
    base.frequency;
  const recurring = kind === "recurring";

  // Revenue: per occurrence for a recurring series, else the stored total.
  const total = {
    good: num(source.revenueScenarios?.good) ?? 0,
    better: num(source.revenueScenarios?.better) ?? 0,
    best: num(source.revenueScenarios?.best) ?? 0,
  };
  const per = recurring
    ? perRun(
        {
          kind: "recurring",
          repeatFrequency: frequency,
          eventDate: source.eventDate ?? null,
          activationDate: source.activationDate ?? null,
          categoryId: source.categoryId ?? null,
          lastOccurrenceDate: source.lastOccurrenceDate,
          revenuePerOccurrence: source.revenuePerOccurrence,
          attrs: a,
          revenueScenarios: total,
        },
        null
      )
    : null;
  const figures = per ?? total;
  const good = Math.round(figures.good * 100) / 100;
  const storedLines = isObject(a.revenue_lines) ? a.revenue_lines : null;
  const lines: Record<string, number> = {};
  if (storedLines) for (const [id, v] of Object.entries(storedLines)) if (num(v) !== null) lines[id] = num(v)!;
  const mode = a.revenue_mode === "lines" && Object.keys(lines).length > 0 ? "lines" : "goal";

  // The record's own questions: dates come back as DraftDates.
  const extras: Row = {};
  for (const extra of ownExtras(config)) {
    const raw = a[extra.key];
    if (raw === undefined || raw === null) continue;
    extras[extra.key] = fieldExtraType(extra) === "date" ? draftDate(raw as DateLike, "day") : typeof raw === "number" ? String(raw) : raw;
  }

  // Category questions: dates as SchemaDates, the rest as stored.
  const category: Row = {};
  const storedCategory = isObject(a.category) ? a.category : {};
  const schema = schemaFor(item.categoryId);
  const fields = schema ? allSchemaFields(schema) : [];
  for (const [key, raw] of Object.entries(storedCategory)) {
    const field = fields.find((f) => f.key === key);
    category[key] = field?.type === "date" ? draftDate(raw as DateLike, "day") : raw;
  }

  const affiliate = isObject(a.affiliate) ? a.affiliate : {};
  const promo = isObject(a.promo_plan) ? a.promo_plan : {};
  const commission = isObject(a.commission) ? a.commission : {};
  const promotedBy = Array.isArray(a.promoted_by) ? a.promoted_by.filter((p): p is string => typeof p === "string") : [];

  return {
    ...base,
    name: source.name,
    notes: source.description ?? "",
    categoryId: (str(source.categoryId) as CategoryId | null) ?? base.categoryId,
    audienceSource: (oneOf<RecordAudienceSource>(["own", "borrowed"], source.audienceSource) ?? base.audienceSource),
    kind,
    conversionPath,
    format,
    frequency,
    dates: {
      activation: draftDate(source.activationDate, source.activationDatePrecision),
      event: kind === "ongoing" ? base.dates.event : draftDate(source.eventDate, source.eventDatePrecision),
      close: draftDate(source.revenueCloseDate, a.revenue_close_date_precision),
      last: recurring ? draftDate(lastOccurrenceOf(source), "day") : { value: null, precision: "day" },
    },
    revenue: {
      mode,
      goal: mode === "goal" ? good : null,
      lines: mode === "lines" ? lines : {},
      better: typedOver(figures.better, autoBetter(good)),
      best: typedOver(figures.best, autoBest(good)),
    },
    productId: str(source.productId),
    plannedBudget: num(source.plannedBudget) ? num(source.plannedBudget) : null,
    attrs: extras,
    promotedBy,
    partner: {
      host: str(a.partner_host),
      bookingStatus: oneOf<BookingStatus>(BOOKING_STATUSES, a.booking_status),
    },
    cart: { opens: draftDate(a.cart_opens as DateLike, a.cart_opens_precision) },
    affiliate: {
      partnerCount: amount(affiliate.partner_count),
      recruitment: oneOf<RecruitmentStatus>(RECRUITMENT_STATUSES, affiliate.recruitment_status),
      terms: str(affiliate.commission_terms) ?? "",
    },
    promoPlan: {
      who: str(promo.who) ?? "",
      sending: someOf<PromoSend>(PROMO_SENDS, promo.sending),
      sends: amount(promo.sends),
    },
    adPlatforms: someOf<AdPlatform>(AD_PLATFORMS, a.ad_platforms),
    funnels: { optin: bool(a.new_optin_funnel), sales: bool(a.new_sales_funnel) },
    commission: {
      offered: bool(commission.offered),
      basis: oneOf<CommissionBasis>(COMMISSION_BASES, commission.basis),
      rate: amount(commission.rate),
    },
    category,
    leads: { goal: amount(a[LEAD_GOAL_ATTR]), handoffTo: str(a[LEAD_HANDOFF_ATTR]) },
  };
}

/**
 * attrs keys the Add form writes. On an edit every one of them is replaced by
 * the form's answer, or removed when the form no longer writes it (a block
 * that is now detached, a question now hidden). Mirrors buildCreateRequest.
 */
const FORM_ATTR_KEYS: readonly string[] = Object.freeze([
  "repeat_frequency",
  "conversion_ask",
  "booking_status",
  "partner_host",
  "promoted_by",
  NO_PROMOTION_ATTR,
  "cart_opens",
  "cart_opens_precision",
  "affiliate",
  "promo_plan",
  "ad_platforms",
  "new_optin_funnel",
  "new_sales_funnel",
  "commission",
  "category",
  "revenue_mode",
  "revenue_lines",
  "revenue_close_date_precision",
  LEAD_GOAL_ATTR,
  LEAD_HANDOFF_ATTR,
]);

/** The saved attrs with the form's keys replaced by `edited`. Pure. */
export function mergeEditedAttrs(
  saved: Readonly<Row> | null | undefined,
  edited: Readonly<Row> | null | undefined,
  config: Pick<LibraryRecordConfig, "fieldExtras">
): Row {
  const out: Row = isObject(saved) ? { ...saved } : {};
  for (const key of FORM_ATTR_KEYS) delete out[key];
  for (const extra of ownExtras(config)) delete out[extra.key];
  if (isObject(edited)) Object.assign(out, edited);
  return out;
}
