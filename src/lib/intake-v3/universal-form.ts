/**
 * The universal initiative form for the Initiative Intake (v3): the draft the
 * form edits, its errors and warnings, and the CreateInitiativeRequest it
 * becomes. The logic only, no UI.
 *
 * EVERY RULE ABOUT WHAT RENDERS LIVES IN library-config.ts. This module asks
 * `resolveFormLayout` and does what it says; it does not add a rule of its own
 * about kinds, paths, formats or blocks. Revenue arithmetic is revenue.ts's
 * (`goalScenarios`), so this form and the add-initiative panel cannot show
 * different Better/Best figures for the same Good.
 *
 * FOUR RULES THE WRITER MUST NOT GET WRONG, all in `buildCreateRequest`:
 *   - kind `ongoing` is stored as `evergreen` (the initiatives column's word);
 *   - every layout silent value is written, though the user never saw it;
 *   - `booking_status` is NEVER written unless `bookingStatusWritten` says so
 *     (the task templates swap on it — see PartnerBlockConfig);
 *   - ASK_UNDECIDED is an answer, not a path: it goes in attrs and the
 *     conversion path stays unset.
 *
 * PURE. No React, no database, no network.
 */

import type { InitiativeKind as StoredKind } from "@/types";
import type { CreateInitiativeRequest, DatePrecision } from "../initiatives/create-request";
import {
  ASK_UNDECIDED,
  CLOSE_DATE_COPY,
  INITIATIVE_FORMATS,
  bookingStatusWritten,
  categoryById,
  fieldExtraType,
  offersAskUndecided,
  resolveFormLayout,
  type AskUndecided,
  type CanonicalCategory,
  type CategoryId,
  type ConversionPath,
  type FieldExtra,
  type FieldExtraBind,
  type FormLayout,
  type InitiativeFormat,
  type InitiativeKind,
  type LibraryRecordConfig,
  type RecordAudienceSource,
  type RecurrenceFrequency,
} from "./library-config";
import {
  IMPLICIT_LINE_ID,
  commissionForScenarios,
  goalScenarios,
  isLeadsPath,
  type CommissionRule,
  type ScenarioTriple,
} from "./revenue";
import type { PickerItem } from "./picker";
import { schemaAttrs, schemaErrors, schemaFor } from "./category-schemas";
import { LEAD_GOAL_ATTR, LEAD_HANDOFF_ATTR } from "../initiatives/lead-handoff";
import type { ScheduleFields } from "../initiatives/schedule";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * One date answer. `value` is YYYY-MM-DD for day precision; for month
 * precision YYYY-MM (YYYY-MM-DD is accepted and read as its month).
 */
export interface DraftDate {
  value: string | null;
  precision: DatePrecision;
}

/**
 * Booking status values.
 *
 * ASSUMED: the contract says booking_status exists and must stay unset where
 * booking is suppressed, but does not define its values.
 */
export type BookingStatus = "pending" | "confirmed";

export const BOOKING_STATUSES: readonly BookingStatus[] = Object.freeze(["pending", "confirmed"]);

export type RevenueMode = "goal" | "lines";

export interface DraftRevenue {
  /** `goal`: one Good figure. `lines`: a Good figure per revenue line. */
  mode: RevenueMode;
  /** Good, in goal mode. Strings are read as goalScenarios reads them. */
  goal: number | string | null;
  /** Good per revenue line id (IMPLICIT_LINE_ID when the record declares none). */
  lines: Readonly<Record<string, number | string | null>>;
}

/** A typed-in number: a number, the raw input string, or nothing yet. */
export type DraftAmount = number | string | null;

/** Affiliate recruitment status. */
export type RecruitmentStatus = "not-started" | "recruiting" | "confirmed";

export const RECRUITMENT_STATUSES: readonly RecruitmentStatus[] = Object.freeze([
  "not-started",
  "recruiting",
  "confirmed",
]);

/** "What they're sending" in the someone-else promo plan. */
export type PromoSend = "email" | "social" | "own-ad-spend" | "dont-know";

export const PROMO_SENDS: readonly PromoSend[] = Object.freeze(["email", "social", "own-ad-spend", "dont-know"]);

export type AdPlatform =
  | "meta"
  | "instagram-feed"
  | "instagram-reels"
  | "youtube"
  | "google"
  | "pinterest"
  | "linkedin"
  | "other";

export const AD_PLATFORMS: readonly AdPlatform[] = Object.freeze([
  "meta",
  "instagram-feed",
  "instagram-reels",
  "youtube",
  "google",
  "pinterest",
  "linkedin",
  "other",
]);

export type CommissionBasis = "percent" | "flat";

export const COMMISSION_BASES: readonly CommissionBasis[] = Object.freeze(["percent", "flat"]);

/** The promotedBy value that reveals the ad platforms and ad budget. */
export const PROMOTION_ADS = "ads";

/** The promotedBy value that reveals "Their promo plan". */
export const PROMOTION_SOMEONE_ELSE = "someone-else";

export interface IntakeDraft {
  /** wb_initiative_library.initiative_key. */
  key: string;
  name: string;
  /**
   * The library record's own name (the picked item's), which the category
   * schema's record gates match on. NOT `name`: the user can rename that.
   */
  libraryName: string;
  categoryId: CategoryId;
  audienceSource: RecordAudienceSource;
  kind: InitiativeKind | null;
  conversionPath: ConversionPath | AskUndecided | null;
  format: InitiativeFormat | null;
  frequency: RecurrenceFrequency | null;
  dates: {
    /** When it starts producing (activation_date). */
    activation: DraftDate;
    /** The event itself. Not written for an ongoing initiative. */
    event: DraftDate;
    /** When it stops producing revenue (revenue_close_date). */
    close: DraftDate;
  };
  revenue: DraftRevenue;
  productId: string | null;
  /**
   * The ad budget: one blended figure across platforms. Only written (as
   * request.plannedBudget) while "Ads" is selected in promotedBy, or always
   * for a Paid Ads initiative (ADS_CATEGORY_ID).
   */
  plannedBudget: DraftAmount;
  notes: string;
  /** Answers to the record's field extras, keyed by FieldExtra.key. */
  attrs: Readonly<Record<string, unknown>>;
  /**
   * What drives attention to this initiative (other initiatives' keys or
   * named channels). ASSUMED SHAPE: the contract does not model promotion.
   */
  promotedBy: readonly string[];
  /** Partner block answers. Only written when the layout attaches the half. */
  partner: { host: string | null; bookingStatus: BookingStatus | null };
  /**
   * Cart block (attached on the offer path). Only the opening date: the cart
   * CLOSES on `dates.close`, which the layout already labels for the offer
   * path, so it is not asked twice.
   */
  cart: { opens: DraftDate };
  /** VIP block (attached by category). Price and capacity only count when offered. */
  vip: { offered: boolean | null; price: DraftAmount; capacity: DraftAmount; included: string };
  /** Affiliate block (attached by category). All optional. */
  affiliate: { partnerCount: DraftAmount; recruitment: RecruitmentStatus | null; terms: string };
  /** "Their promo plan": revealed while PROMOTION_SOMEONE_ELSE is selected. */
  promoPlan: { who: string; sending: readonly PromoSend[]; sends: DraftAmount };
  /** Revealed while PROMOTION_ADS is selected. */
  adPlatforms: readonly AdPlatform[];
  /** "New opt-in funnel?" / "New sales funnel?". Always asked, optional. */
  funnels: { optin: boolean | null; sales: boolean | null };
  /** "Is there a sales commission?" Basis and rate only count when Yes. */
  commission: { offered: boolean | null; basis: CommissionBasis | null; rate: DraftAmount };
  /**
   * Category schema answers, keyed by SchemaField.key (category-schemas.ts).
   * Hidden answers stay here; only visible, answered ones are written.
   */
  category: Readonly<Record<string, unknown>>;
  /**
   * Leads path only (the revenue slot's replacement): the lead-count goal, and
   * the initiative that converts the leads (the lead-handoff block). Optional
   * so a draft built before this existed still reads; absent is blank.
   * `handoffTo` null is "Decide later".
   */
  leads?: { goal: DraftAmount; handoffTo: string | null };
}

export type DraftMessages = Readonly<Record<string, string>>;

/** The exact copy of the no-promotion warning. */
export const NO_PROMOTION_WARNING = "Nothing is driving this one.";

/**
 * The promotedBy value for "No promotion needed". An answer, so it is stored
 * like any other driver, but it does not count as one for the warning.
 */
export const NO_PROMOTION_NEEDED = "no-promotion-needed";

/**
 * attrs key set to `true` on save when the no-promotion warning held (the
 * initiative projects revenue with nothing promoting it), whether or not the
 * user dismissed the warning. The initiative card shows a quiet marker for it.
 */
export const NO_PROMOTION_ATTR = "no_promotion";

/**
 * Does a saved initiative carry the no-promotion marker? Only a literal `true`
 * counts. Read by the initiative card.
 */
export function hasNoPromotionMarker(initiative: { attrs?: Readonly<Record<string, unknown>> | null }): boolean {
  return initiative.attrs?.[NO_PROMOTION_ATTR] === true;
}

const MAX_NAME = 200;

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

function categoryOf(draft: Pick<IntakeDraft, "categoryId">): CanonicalCategory {
  const category = categoryById(draft.categoryId);
  // CategoryId is a closed union; this only fires on a cast-in bad value.
  if (!category) throw new Error(`Unknown category "${String(draft.categoryId)}".`);
  return category;
}

/** The form as it stands for this draft. A thin wrapper over resolveFormLayout. */
export function layoutFor(draft: IntakeDraft, config: LibraryRecordConfig): FormLayout {
  return resolveFormLayout({
    config,
    category: categoryOf(draft),
    answers: { kind: draft.kind, conversionPath: draft.conversionPath },
  });
}

/* ------------------------------------------------------------------ *
 * Initial draft
 * ------------------------------------------------------------------ */

const emptyDate = (): DraftDate => ({ value: null, precision: "day" });

/**
 * A fresh draft for a picked initiative: silent values pre-applied, the first
 * allowed kind chosen, and the category's default format preselected.
 */
export function initialDraft(item: PickerItem, config: LibraryRecordConfig): IntakeDraft {
  const kind = config.allowedKinds[0] ?? null;
  const base: IntakeDraft = {
    key: item.key,
    name: item.name,
    libraryName: item.name,
    categoryId: item.categoryId,
    audienceSource: config.audienceSource,
    kind,
    conversionPath: null,
    format: null,
    frequency: null,
    dates: { activation: emptyDate(), event: emptyDate(), close: emptyDate() },
    revenue: { mode: "goal", goal: null, lines: {} },
    productId: null,
    plannedBudget: null,
    notes: "",
    attrs: {},
    promotedBy: [],
    partner: { host: null, bookingStatus: null },
    cart: { opens: emptyDate() },
    vip: { offered: null, price: null, capacity: null, included: "" },
    affiliate: { partnerCount: null, recruitment: null, terms: "" },
    promoPlan: { who: "", sending: [], sends: null },
    adPlatforms: [],
    funnels: { optin: null, sales: null },
    commission: { offered: null, basis: null, rate: null },
    category: {},
    leads: { goal: null, handoffTo: null },
  };
  const layout = layoutFor(base, config);
  return {
    ...base,
    kind: layout.effectiveKind ?? kind,
    conversionPath: layout.conversionPath.state === "suppressed" ? layout.conversionPath.value : null,
    format: layout.format.state === "suppressed" ? layout.format.value : layout.formatDefault,
    frequency: layout.frequency.state === "suppressed" ? layout.frequency.value : null,
  };
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^(\d{4})-(\d{2})(?:-\d{2})?$/;

type ReadDate =
  | { status: "empty" }
  | { status: "invalid" }
  /** `stored` is what is written: the day, or the 1st of the month. */
  | { status: "ok"; stored: string; month: string; precision: DatePrecision };

function realDay(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function readDate(date: DraftDate): ReadDate {
  const v = date.value?.trim() ?? "";
  if (v === "") return { status: "empty" };
  if (date.precision === "month") {
    const m = MONTH_RE.exec(v);
    if (!m) return { status: "invalid" };
    const stored = `${m[1]}-${m[2]}-01`;
    return realDay(stored) ? { status: "ok", stored, month: stored.slice(0, 7), precision: "month" } : { status: "invalid" };
  }
  if (date.precision !== "day" || !DAY_RE.test(v) || !realDay(v)) return { status: "invalid" };
  return { status: "ok", stored: v, month: v.slice(0, 7), precision: "day" };
}

/**
 * Is `later` before `earlier`? With either end month-only, compared by month:
 * a month-only end could be any day of it, so only an earlier MONTH is wrong.
 */
function before(later: Extract<ReadDate, { status: "ok" }>, earlier: Extract<ReadDate, { status: "ok" }>): boolean {
  if (later.precision === "month" || earlier.precision === "month") return later.month < earlier.month;
  return later.stored < earlier.stored;
}

/* ------------------------------------------------------------------ *
 * Field extras
 *
 * Answers live in draft.attrs[extra.key]: a string for text, a number or the
 * raw input string for number, a DraftDate for date. Only DECLARED, UNBOUND
 * extras are ever written; a bound extra is the universal field it binds and
 * stores no copy.
 * ------------------------------------------------------------------ */

/** The draftErrors key for an extra. */
export const extraErrorKey = (key: string): string => `attrs.${key}`;

/** The extras asked as their own question, after the category fields. */
export function ownExtras(config: Pick<LibraryRecordConfig, "fieldExtras">): FieldExtra[] {
  return config.fieldExtras.filter((e) => !e.binds);
}

/**
 * The extra that stands in for a universal cart field, or null.
 *
 * Both bind targets are cart dates, so a bound extra only applies while the
 * cart block is attached: on the calls path "Cart closes" would be the wrong
 * word for the close date.
 */
export function boundExtra(
  config: Pick<LibraryRecordConfig, "fieldExtras">,
  layout: FormLayout,
  target: FieldExtraBind
): FieldExtra | null {
  if (!attachedBlockIds(layout).has("cart")) return null;
  return config.fieldExtras.find((e) => e.binds === target) ?? null;
}

/** The close date's label: the layout's, or a bound extra's while the cart is attached. */
export function closeDateLabel(config: Pick<LibraryRecordConfig, "fieldExtras">, layout: FormLayout): string {
  return boundExtra(config, layout, "dates.close")?.label ?? layout.closeDate.label;
}

/* ------------------------------------------------------------------ *
 * Ongoing: the close date defaults to the end of the plan year
 * ------------------------------------------------------------------ */

/**
 * The default close date for an ongoing initiative: 31 December of the plan
 * year, or of the start date's year when no plan year is known. Null when
 * neither is known.
 */
export function ongoingCloseDefault(planYear: number | null | undefined, activation: DraftDate): string | null {
  if (typeof planYear === "number" && Number.isInteger(planYear) && planYear >= 1000 && planYear <= 9999) {
    return `${planYear}-12-31`;
  }
  const a = readDate(activation);
  return a.status === "ok" ? `${a.stored.slice(0, 4)}-12-31` : null;
}

/** Fill a blank close date with the plan-year end while the draft is ongoing. */
export function withOngoingCloseDefault(
  draft: IntakeDraft,
  config: LibraryRecordConfig,
  planYear: number | null | undefined
): IntakeDraft {
  if (layoutFor(draft, config).effectiveKind !== "ongoing") return draft;
  if (readDate(draft.dates.close).status !== "empty") return draft;
  const value = ongoingCloseDefault(planYear, draft.dates.activation);
  return value ? { ...draft, dates: { ...draft.dates, close: { value, precision: "day" } } } : draft;
}

/**
 * Change the kind. Moving to ongoing prefills a blank close date with the
 * plan-year end; moving away clears it again if it still holds that default,
 * so "Cart closes" does not arrive pre-answered with a date nobody chose.
 */
export function setDraftKind(
  draft: IntakeDraft,
  config: LibraryRecordConfig,
  kind: InitiativeKind,
  planYear: number | null | undefined
): IntakeDraft {
  const wasOngoing = layoutFor(draft, config).effectiveKind === "ongoing";
  let next: IntakeDraft = { ...draft, kind };
  const isOngoing = layoutFor(next, config).effectiveKind === "ongoing";
  if (wasOngoing && !isOngoing) {
    const fallback = ongoingCloseDefault(planYear, draft.dates.activation);
    const close = draft.dates.close;
    if (fallback && close.precision === "day" && close.value?.trim() === fallback) {
      next = { ...next, dates: { ...next.dates, close: emptyDate() } };
    }
  }
  return withOngoingCloseDefault(next, config, planYear);
}

const asDraftDate = (v: unknown): DraftDate | null =>
  typeof v === "object" && v !== null && "value" in v && "precision" in v ? (v as DraftDate) : null;

const dateKey = (d: DraftDate | null): string => {
  const v = d?.value?.trim() ?? "";
  return v === "" ? "" : `${d!.precision}:${v}`;
};

type ExtraRead = { status: "empty" } | { status: "invalid" } | { status: "ok"; value: unknown };

function readExtra(extra: FieldExtra, raw: unknown): ExtraRead {
  if (raw === null || raw === undefined) return { status: "empty" };
  switch (fieldExtraType(extra)) {
    case "number": {
      if (typeof raw !== "number" && typeof raw !== "string") return { status: "invalid" };
      const n = readNumber(raw);
      return n.status === "ok" ? { status: "ok", value: n.value } : n;
    }
    case "date": {
      const date = asDraftDate(raw);
      if (!date) return { status: "invalid" };
      const d = readDate(date);
      return d.status === "ok" ? { status: "ok", value: d.stored } : d;
    }
    default: {
      if (typeof raw !== "string") return { status: "invalid" };
      const t = raw.trim();
      return t === "" ? { status: "empty" } : { status: "ok", value: t };
    }
  }
}

function extraErrors(draft: IntakeDraft, config: LibraryRecordConfig, errors: Record<string, string>): void {
  for (const extra of ownExtras(config)) {
    if (readExtra(extra, draft.attrs[extra.key]).status !== "invalid") continue;
    const type = fieldExtraType(extra);
    errors[extraErrorKey(extra.key)] =
      type === "number" ? "Enter a valid number." : type === "date" ? "Enter a valid date." : "Enter text.";
  }
}

/** attrs for the declared, unbound extras that have a readable answer. */
export function extraAttrs(draft: Pick<IntakeDraft, "attrs">, config: LibraryRecordConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const extra of ownExtras(config)) {
    const read = readExtra(extra, draft.attrs[extra.key]);
    if (read.status === "ok") out[extra.key] = read.value;
  }
  return out;
}

/**
 * Set one extra's answer, and let a deriving extra carry the cart date with it.
 *
 * THE CART FOLLOWS UNTIL THE USER MOVES IT. Cart opens takes the new pitch day
 * (or webinar date) while it is empty or still equal to the previous one; once
 * the user has typed a different cart date it is theirs and stays put. The
 * cart date is set even while the cart is not attached, so choosing the offer
 * path later finds it already filled; it is only written while attached.
 *
 * An undeclared or bound key changes nothing.
 */
export function setExtraAnswer(
  draft: IntakeDraft,
  config: Pick<LibraryRecordConfig, "fieldExtras">,
  key: string,
  value: unknown
): IntakeDraft {
  const extra = ownExtras(config).find((e) => e.key === key);
  if (!extra) return draft;
  const next: IntakeDraft = { ...draft, attrs: { ...draft.attrs, [key]: value } };
  if (extra.derives !== "cart.opens" || fieldExtraType(extra) !== "date") return next;

  const current = dateKey(draft.cart.opens);
  const follows = current === "" || current === dateKey(asDraftDate(draft.attrs[key]));
  if (!follows) return next;
  const date = asDraftDate(value);
  return { ...next, cart: { ...draft.cart, opens: date ? { ...date } : emptyDate() } };
}

/**
 * The note under Cart opens while it is following a deriving extra, e.g.
 * "Your cart opens on pitch day.", or null when nothing derives it or the user
 * has moved it.
 */
export function cartOpensHint(
  draft: Pick<IntakeDraft, "attrs" | "cart">,
  config: Pick<LibraryRecordConfig, "fieldExtras">
): string | null {
  const extra = ownExtras(config).find((e) => e.derives === "cart.opens");
  if (!extra) return null;
  const source = dateKey(asDraftDate(draft.attrs[extra.key]));
  if (source === "" || source !== dateKey(draft.cart.opens)) return null;
  const label = extra.label.trim().toLowerCase();
  return `Your cart opens on ${label.endsWith("date") ? `the ${label}` : label}.`;
}

/* ------------------------------------------------------------------ *
 * Revenue
 * ------------------------------------------------------------------ */

/** The line ids the user answers per line: the record's, or the implicit one. */
export function revenueLineIds(config: Pick<LibraryRecordConfig, "revenueLines">): string[] {
  return config.revenueLines.length === 0 ? [IMPLICIT_LINE_ID] : config.revenueLines.map((l) => l.id);
}

type RevenueRead =
  | { ok: true; scenarios: ScenarioTriple; lines: Record<string, number> | null }
  | { ok: false; errors: Record<string, string> };

function readRevenue(draft: IntakeDraft, config: LibraryRecordConfig, layout: FormLayout): RevenueRead {
  // The leads path earns nothing by definition (revenue.ts): no target to ask for.
  if (isLeadsPath(layout.effectivePath)) {
    return { ok: true, scenarios: { good: 0, better: 0, best: 0 }, lines: null };
  }
  if (draft.revenue.mode === "goal") {
    const goal = goalScenarios(draft.revenue.goal);
    return goal.ok ? { ok: true, scenarios: goal.scenarios, lines: null } : { ok: false, errors: { "revenue.goal": goal.message } };
  }
  const errors: Record<string, string> = {};
  const lines: Record<string, number> = {};
  for (const id of revenueLineIds(config)) {
    const line = goalScenarios(draft.revenue.lines[id]);
    if (line.ok) lines[id] = line.scenarios.good;
    else errors[`revenue.lines.${id}`] = line.message;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const total = Object.values(lines).reduce((s, n) => s + n, 0);
  // Total is finite and >= 0, so this cannot refuse.
  const goal = goalScenarios(total);
  return { ok: true, scenarios: goal.ok ? goal.scenarios : { good: 0, better: 0, best: 0 }, lines };
}

/* ------------------------------------------------------------------ *
 * Conditional blocks and answer-gated reveals
 * ------------------------------------------------------------------ */

type NumberRead = { status: "empty" } | { status: "invalid" } | { status: "ok"; value: number };

/**
 * Read a typed-in number. Blank is `empty`; anything that is not a finite
 * number >= 0 (or, with `whole`, not an integer) is `invalid`. Strict
 * `Number()`, not `parseFloat`: "12abc" is not 12.
 */
function readNumber(v: DraftAmount | undefined, opts: { whole?: boolean } = {}): NumberRead {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { status: "empty" };
  const n = typeof v === "number" ? v : Number(v.trim());
  if (!Number.isFinite(n) || n < 0) return { status: "invalid" };
  if (opts.whole && !Number.isInteger(n)) return { status: "invalid" };
  return { status: "ok", value: n };
}

/** The ids of the blocks the layout attaches. The only source of block gating. */
export function attachedBlockIds(layout: FormLayout): ReadonlySet<string> {
  return new Set(layout.blocks.filter((b) => b.attached).map((b) => b.id));
}

/**
 * The category whose initiatives ARE ads: the ad platforms and ad budget are
 * always revealed (and plannedBudget always written) there, whether or not
 * "Ads" is ticked under "What's promoting it?".
 */
export const ADS_CATEGORY_ID: CategoryId = "paid-ads";

/**
 * Which marketing answers are revealed by the "What's promoting it?" choice.
 * Answer-gated, not layout-gated: the trigger is the user's own selection,
 * except that the Ads reveal is always on for ADS_CATEGORY_ID.
 */
export function marketingReveals(
  draft: Pick<IntakeDraft, "promotedBy" | "categoryId">
): { promoPlan: boolean; ads: boolean } {
  return {
    promoPlan: draft.promotedBy.includes(PROMOTION_SOMEONE_ELSE),
    ads: draft.categoryId === ADS_CATEGORY_ID || draft.promotedBy.includes(PROMOTION_ADS),
  };
}

/** The commission rule the draft describes, or null when there is none (yet). */
export function commissionRule(draft: Pick<IntakeDraft, "commission">): CommissionRule | null {
  const { offered, basis, rate } = draft.commission;
  if (offered !== true || !basis) return null;
  const r = readNumber(rate);
  if (r.status !== "ok" || r.value <= 0) return null;
  if (basis === "percent") return r.value <= 100 ? { type: "percent", percent: r.value } : null;
  return { type: "flat", perSale: r.value };
}

/**
 * What the commission line under Expenses shows.
 *
 *   off               No commission, or the answers are not complete yet.
 *   no-revenue        A rule, but nothing projected to take it on.
 *   needs-sales-count A flat per-sale rule: commissionForScenarios needs a
 *                     unit price to count sales, and the form has none.
 *   ok                Commission per Good / Better / Best.
 */
export type CommissionPreview =
  | { status: "off" }
  | { status: "no-revenue" }
  | { status: "needs-sales-count"; message: string }
  | { status: "ok"; good: number; better: number; best: number };

export function commissionPreview(draft: IntakeDraft, config: LibraryRecordConfig): CommissionPreview {
  const rule = commissionRule(draft);
  if (!rule) return { status: "off" };
  const projected = projectedScenarios(draft, config);
  if (!projected) return { status: "no-revenue" };
  // No unit price is known to this form (products carry no price here), so a
  // flat rule comes back missing_price — reported, never guessed.
  const result = commissionForScenarios(projected, rule, null);
  if (!result.ok) {
    return result.reason === "missing_price"
      ? {
          status: "needs-sales-count",
          message: "A flat per-sale commission needs a sale count, so it isn't calculated here.",
        }
      : { status: "off" };
  }
  const v = (c: typeof result.good) => (c.status === "available" ? c.commission : 0);
  return { status: "ok", good: v(result.good), better: v(result.better), best: v(result.best) };
}

function blockErrors(
  draft: IntakeDraft,
  config: LibraryRecordConfig,
  layout: FormLayout,
  activation: ReadDate,
  close: ReadDate,
  errors: Record<string, string>
): void {
  const attached = attachedBlockIds(layout);

  if (attached.has("cart")) {
    const opens = readDate(draft.cart.opens);
    if (opens.status === "empty") errors["cart.opens"] = "Enter the cart opens date.";
    else if (opens.status === "invalid") errors["cart.opens"] = "Enter a valid cart opens date.";
    else if (activation.status === "ok" && before(opens, activation)) {
      errors["cart.opens"] = "Cart opens can't be before the start date.";
    } else if (close.status === "ok" && before(close, opens)) {
      errors["cart.opens"] = "The cart can't open after it closes.";
    }
  }

  if (attached.has("vip") && draft.vip.offered === true) {
    const price = readNumber(draft.vip.price);
    if (price.status === "empty") errors["vip.price"] = "Enter the VIP price.";
    else if (price.status === "invalid" || price.value <= 0) errors["vip.price"] = "Enter a valid VIP price.";
    if (readNumber(draft.vip.capacity, { whole: true }).status === "invalid") {
      errors["vip.capacity"] = "Enter capacity as a whole number.";
    }
  }

  if (attached.has("affiliate") && readNumber(draft.affiliate.partnerCount, { whole: true }).status === "invalid") {
    errors["affiliate.partnerCount"] = "Enter the partner count as a whole number.";
  }

  const reveals = marketingReveals(draft);
  if (reveals.promoPlan && readNumber(draft.promoPlan.sends, { whole: true }).status === "invalid") {
    errors["promoPlan.sends"] = "Enter the number of sends as a whole number.";
  }
  if (reveals.ads && readNumber(draft.plannedBudget).status === "invalid") {
    errors.plannedBudget = "Enter a valid ad budget.";
  }

  if (draft.commission.offered === true) {
    const { basis } = draft.commission;
    if (!basis || !COMMISSION_BASES.includes(basis)) errors["commission.basis"] = "Choose how the commission is paid.";
    const rate = readNumber(draft.commission.rate);
    if (rate.status === "empty") errors["commission.rate"] = "Enter the commission rate.";
    else if (rate.status === "invalid" || rate.value <= 0) errors["commission.rate"] = "Enter a valid commission rate.";
    else if (basis === "percent" && rate.value > 100) errors["commission.rate"] = "A percentage can't be over 100.";
  }
}

/* ------------------------------------------------------------------ *
 * Errors and warnings
 * ------------------------------------------------------------------ */

/** Field -> message for everything that blocks saving. Empty when the draft is valid. */
export function draftErrors(draft: IntakeDraft, config: LibraryRecordConfig): DraftMessages {
  const errors: Record<string, string> = {};
  const layout = layoutFor(draft, config);

  const name = draft.name.trim();
  if (name === "") errors.name = "Give the initiative a name.";
  else if (name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters.`;

  if (layout.kind.state === "rendered") {
    if (!draft.kind) errors.kind = "Choose how this initiative runs.";
    else if (!config.allowedKinds.includes(draft.kind)) errors.kind = "That kind is not available for this initiative.";
  }

  if (layout.format.state === "rendered") {
    if (!draft.format) errors.format = "Choose in-person, digital or hybrid.";
    else if (!INITIATIVE_FORMATS.includes(draft.format)) errors.format = "That format is not available.";
  }

  if (layout.conversionPath.state === "absent") {
    errors.conversionPath = "This initiative has no conversion path available.";
  } else if (layout.conversionPath.state === "rendered") {
    const path = draft.conversionPath;
    if (!path) errors.conversionPath = "Choose what the ask is.";
    else if (path === ASK_UNDECIDED) {
      if (!offersAskUndecided(draft.categoryId)) errors.conversionPath = "Choose what the ask is.";
    } else if (!layout.availablePaths.includes(path)) {
      errors.conversionPath = "That conversion path is not available for this initiative.";
    }
  }

  if (layout.frequency.state === "rendered") {
    if (!draft.frequency) errors.frequency = "Choose how often it repeats.";
    else if (!config.allowedFrequencies.includes(draft.frequency)) errors.frequency = "That frequency is not available.";
  }

  const activation = readDate(draft.dates.activation);
  const close = readDate(draft.dates.close);
  const event = layout.eventDate.state === "rendered" ? readDate(draft.dates.event) : ({ status: "empty" } as const);

  if (activation.status === "empty") errors["dates.activation"] = "Enter a start date.";
  else if (activation.status === "invalid") errors["dates.activation"] = "Enter a valid start date.";

  // One field; its wording and whether it is required come from the layout.
  const closeCopy = CLOSE_DATE_COPY[layout.closeDate.variant];
  if (close.status === "empty") {
    if (layout.closeDate.required) errors["dates.close"] = closeCopy.empty;
  } else if (close.status === "invalid") errors["dates.close"] = closeCopy.invalid;
  else if (activation.status === "ok" && before(close, activation)) {
    errors["dates.close"] = closeCopy.beforeStart;
  }

  if (event.status === "invalid") errors["dates.event"] = "Enter a valid event date.";
  else if (event.status === "empty" && layout.effectiveKind === "one-time") {
    errors["dates.event"] = "Enter the event date.";
  } else if (event.status === "ok" && activation.status === "ok" && before(event, activation)) {
    errors["dates.event"] = "The event can't be before the start date.";
  }

  blockErrors(draft, config, layout, activation, close, errors);
  Object.assign(errors, schemaErrors(schemaFor(draft.categoryId), draft, draft.libraryName, layout));
  extraErrors(draft, config, errors);

  const revenue = readRevenue(draft, config, layout);
  if (!revenue.ok) Object.assign(errors, revenue.errors);

  if (isLeadsPath(layout.effectivePath) && readNumber(draft.leads?.goal, { whole: true }).status === "invalid") {
    errors["leads.goal"] = "Enter the lead goal as a whole number.";
  }

  if (
    draft.partner.bookingStatus !== null &&
    bookingStatusWritten(layout) &&
    !BOOKING_STATUSES.includes(draft.partner.bookingStatus)
  ) {
    errors["partner.bookingStatus"] = "Choose whether the slot is booked.";
  }

  return errors;
}

/**
 * The Good / Better / Best this draft projects, or null when it projects
 * nothing usable: the leads path (earns nothing by definition) or a revenue
 * answer that does not read (missing or invalid).
 */
export function projectedScenarios(draft: IntakeDraft, config: LibraryRecordConfig): ScenarioTriple | null {
  const layout = layoutFor(draft, config);
  if (isLeadsPath(layout.effectivePath)) return null;
  const revenue = readRevenue(draft, config, layout);
  return revenue.ok ? revenue.scenarios : null;
}

/**
 * Field -> message for things worth pointing out that do not block saving.
 *
 * `promotion`: nothing is promoting an initiative that projects revenue. Fires
 * when no driver is selected, or when NO_PROMOTION_NEEDED is the only one —
 * the user said so explicitly, but the warning is still worth reading once,
 * because a partner doing the promoting is the common mis-pick. Silent when
 * there is no positive projection to be built on nothing.
 */
export function draftWarnings(draft: IntakeDraft, config: LibraryRecordConfig): DraftMessages {
  const warnings: Record<string, string> = {};
  const drivers = draft.promotedBy.map((p) => p.trim()).filter((p) => p !== "" && p !== NO_PROMOTION_NEEDED);
  if (drivers.length === 0) {
    const projected = projectedScenarios(draft, config);
    if (projected && projected.good > 0) warnings.promotion = NO_PROMOTION_WARNING;
  }
  return warnings;
}

/**
 * The draft as a lead-handoff party: its name and start date in the shape
 * handoffWarnings reads. A start date that does not read is left unset, so
 * no ordering warning is guessed from it.
 */
export function draftHandoffParty(draft: Pick<IntakeDraft, "name" | "dates" | "categoryId" | "libraryName">): ScheduleFields & {
  name: string;
} {
  const activation = readDate(draft.dates.activation);
  return {
    name: draft.name.trim() || draft.libraryName,
    categoryId: draft.categoryId,
    activationDate: activation.status === "ok" ? activation.stored : null,
    activationDatePrecision: activation.status === "ok" ? activation.precision : "day",
  };
}

/* ------------------------------------------------------------------ *
 * The request
 * ------------------------------------------------------------------ */

/** The initiatives column's word for each contract kind. */
const STORED_KIND: Readonly<Record<InitiativeKind, StoredKind>> = Object.freeze({
  "one-time": "one-time",
  recurring: "recurring",
  ongoing: "evergreen",
});

/** Silent values that map onto request fields rather than into attrs. */
const SILENT_REQUEST_FIELDS: ReadonlySet<string> = new Set(["kind", "format", "conversion_path"]);

/**
 * attrs keys owned by the form's own blocks. Stripped from `draft.attrs`
 * before the blocks write theirs, so an extra answer cannot smuggle in a
 * value for a block that is detached (or for booking_status).
 */
const SYSTEM_ATTR_KEYS: readonly string[] = Object.freeze([
  "booking_status",
  "partner_host",
  "cart_opens",
  "cart_opens_precision",
  "vip",
  "affiliate",
  "promo_plan",
  "ad_platforms",
  "new_optin_funnel",
  "new_sales_funnel",
  "commission",
  "category",
  LEAD_GOAL_ATTR,
  LEAD_HANDOFF_ATTR,
  NO_PROMOTION_ATTR,
]);

/** A valid number answer, or null (blank or invalid — draftErrors catches invalid). */
function numberOrNull(v: DraftAmount): number | null {
  const r = readNumber(v);
  return r.status === "ok" ? r.value : null;
}

const textOrNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/**
 * The POST /api/initiatives body for this draft.
 *
 * THROWS on a draft with errors: call `draftErrors` first. A request built
 * from an invalid draft would write a guess, and the server's own checks do
 * not know the layout rules.
 */
export function buildCreateRequest(
  draft: IntakeDraft,
  config: LibraryRecordConfig,
  context: { annualPlanId: string }
): CreateInitiativeRequest {
  const errors = draftErrors(draft, config);
  const fields = Object.keys(errors);
  if (fields.length > 0) throw new Error(`The draft is not ready to save: ${fields.join(", ")}.`);

  const layout = layoutFor(draft, config);
  const kind = layout.effectiveKind as InitiativeKind; // non-null: draftErrors checked it
  const isOngoing = kind === "ongoing";

  // The declared extras' answers first (and nothing else from draft.attrs);
  // everything below overrides them, so an extra cannot smuggle in a system
  // key such as booking_status.
  const attrs: Record<string, unknown> = extraAttrs(draft, config);
  for (const key of SYSTEM_ATTR_KEYS) delete attrs[key];

  for (const [key, value] of Object.entries(layout.silentValues)) {
    if (!SILENT_REQUEST_FIELDS.has(key)) attrs[key] = value;
  }
  if (layout.frequency.state === "rendered" && draft.frequency) attrs.repeat_frequency = draft.frequency;

  // Conversion path: the effective one, or the undecided answer in attrs.
  const undecided =
    layout.conversionPath.state === "rendered" && draft.conversionPath === ASK_UNDECIDED;
  if (undecided) attrs.conversion_ask = ASK_UNDECIDED;

  // Format: suppressed writes its value, rendered writes the answer, absent writes nothing.
  const format =
    layout.format.state === "suppressed"
      ? layout.format.value
      : layout.format.state === "rendered"
        ? draft.format
        : null;

  const attached = new Set(layout.blocks.filter((b) => b.attached).map((b) => b.id));
  if (attached.has("partner-host") && draft.partner.host?.trim()) attrs.partner_host = draft.partner.host.trim();
  if (bookingStatusWritten(layout) && draft.partner.bookingStatus) {
    attrs.booking_status = draft.partner.bookingStatus;
  }

  const promotedBy = draft.promotedBy.map((p) => p.trim()).filter((p) => p !== "");
  if (promotedBy.length > 0) attrs.promoted_by = promotedBy;
  // Recorded whether or not the warning was dismissed: dismissing hides it
  // for the draft, it does not make the initiative promoted.
  if (draftWarnings(draft, config).promotion) attrs[NO_PROMOTION_ATTR] = true;

  // Conditional blocks: written only while the layout attaches them.
  if (attached.has("cart")) {
    const opens = readDate(draft.cart.opens);
    if (opens.status === "ok") {
      attrs.cart_opens = opens.stored;
      if (opens.precision === "month") attrs.cart_opens_precision = "month";
    }
  }
  if (attached.has("vip") && draft.vip.offered !== null) {
    const yes = draft.vip.offered === true;
    attrs.vip = {
      offered: yes,
      price: yes ? numberOrNull(draft.vip.price) : null,
      capacity: yes ? numberOrNull(draft.vip.capacity) : null,
      included: yes ? textOrNull(draft.vip.included) : null,
    };
  }
  if (attached.has("affiliate")) {
    const affiliate = {
      partner_count: numberOrNull(draft.affiliate.partnerCount),
      recruitment_status: draft.affiliate.recruitment,
      commission_terms: textOrNull(draft.affiliate.terms),
    };
    if (Object.values(affiliate).some((v) => v !== null)) attrs.affiliate = affiliate;
  }

  // Marketing reveals: written only while their trigger is selected.
  const reveals = marketingReveals(draft);
  if (reveals.promoPlan) {
    const sending = PROMO_SENDS.filter((s) => draft.promoPlan.sending.includes(s));
    const plan = {
      who: textOrNull(draft.promoPlan.who),
      sending: sending.length > 0 ? sending : null,
      sends: numberOrNull(draft.promoPlan.sends),
    };
    if (Object.values(plan).some((v) => v !== null)) attrs.promo_plan = plan;
  }
  if (reveals.ads) {
    const platforms = AD_PLATFORMS.filter((p) => draft.adPlatforms.includes(p));
    if (platforms.length > 0) attrs.ad_platforms = platforms;
  }
  if (draft.funnels.optin !== null) attrs.new_optin_funnel = draft.funnels.optin;
  if (draft.funnels.sales !== null) attrs.new_sales_funnel = draft.funnels.sales;

  if (draft.commission.offered !== null) {
    const yes = draft.commission.offered === true;
    attrs.commission = {
      offered: yes,
      basis: yes ? draft.commission.basis : null,
      rate: yes ? numberOrNull(draft.commission.rate) : null,
    };
  }

  // Category schema: visible, answered fields only; bound fields are written above.
  const category = schemaAttrs(schemaFor(draft.categoryId), draft, draft.libraryName, layout);
  if (category) attrs.category = category;

  const revenue = readRevenue(draft, config, layout);
  const scenarios = revenue.ok ? revenue.scenarios : { good: 0, better: 0, best: 0 };
  if (!isLeadsPath(layout.effectivePath)) {
    attrs.revenue_mode = draft.revenue.mode;
    if (revenue.ok && revenue.lines) attrs.revenue_lines = revenue.lines;
  } else {
    // The leads path's goal is a lead count; its revenue stays $0.
    const leadGoal = numberOrNull(draft.leads?.goal ?? null);
    if (leadGoal !== null) attrs[LEAD_GOAL_ATTR] = leadGoal;
  }
  // Only while the block is attached, and only when a target was chosen
  // ("Decide later" writes nothing).
  const handoffTo = draft.leads?.handoffTo?.trim() ?? "";
  if (attached.has("lead-handoff") && handoffTo !== "") attrs[LEAD_HANDOFF_ATTR] = handoffTo;

  const activation = readDate(draft.dates.activation);
  const event = isOngoing ? ({ status: "empty" } as const) : readDate(draft.dates.event);
  const close = readDate(draft.dates.close);
  if (close.status === "ok" && close.precision === "month") attrs.revenue_close_date_precision = "month";

  const request: CreateInitiativeRequest = {
    libraryKey: draft.key,
    annualPlanId: context.annualPlanId,
    productId: draft.productId,
    name: draft.name.trim(),
    description: draft.notes,
    kind: STORED_KIND[kind],
    activationDate: activation.status === "ok" ? activation.stored : null,
    eventDate: event.status === "ok" ? event.stored : null,
    trafficInput: null,
    // The ad budget, only while the Ads reveal is on ("Ads" selected, or a
    // Paid Ads initiative); deselecting it drops it.
    plannedBudget: reveals.ads ? (numberOrNull(draft.plannedBudget) ?? 0) : 0,
    revenueScenarios: scenarios,
    audienceSource: draft.audienceSource,
    format,
    categoryId: draft.categoryId,
    revenueCloseDate: close.status === "ok" ? close.stored : null,
    activationDatePrecision: activation.status === "ok" ? activation.precision : "day",
    eventDatePrecision: event.status === "ok" ? event.precision : "day",
    attrs,
  };
  // Unset, not null, when undecided: "I don't know yet" is not a path.
  if (layout.effectivePath && !undecided) request.conversionPath = layout.effectivePath;
  return request;
}
