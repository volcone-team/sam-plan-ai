/**
 * Category schemas for the Initiative Intake (v3): the questions a category
 * asks on top of the universal form, rendered at CATEGORY_SCHEMA_SLOT
 * (between Shape and Dates).
 *
 * THE DATA IS THE OWNER'S TRANSCRIPTION, kept verbatim in
 * docs/intake-screens/category-schemas.md. Labels, options, hints and tags
 * here are copied from it; only keys and gates are ours.
 *
 * BOUND FIELDS ARE NEVER RENDERED. A field with `binds` repeats a question the
 * universal form already asks (who's hosting, is it booked, the cart, VIP...).
 * It stays in the data so the design is documented in one place, but
 * `visibleSchemaFields` drops it and `schemaAttrs` never writes it: the
 * universal form owns that answer and writes it itself.
 *
 * HIDDEN ANSWERS ARE KEPT IN THE DRAFT AND DROPPED ON WRITE. A gate that closes
 * does not erase what was typed (so toggling back restores it), but only
 * visible, answered fields reach attrs.category.
 *
 * PURE. No React, no database, no network.
 */

import type { DatePrecision } from "../initiatives/create-request";
import { normalizeKey } from "../workbook/parse";
import type {
  CategoryId,
  ConditionalBlockId,
  FormLayout,
  InitiativeKind,
  RecordAudienceSource,
} from "./library-config";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export type SchemaFieldType = "yesno" | "single" | "multi" | "text" | "number" | "currency" | "date";

/** Universal-form answers a schema field may duplicate. */
export type SchemaBind =
  | "partner.host"
  | "partner.bookingStatus"
  | "format"
  | "vip.offered"
  | "cart"
  | "close"
  | "conversionPath"
  | "affiliate.partnerCount"
  | "affiliate.terms"
  | "plannedBudget"
  | "adPlatforms";

/** A gate value: an option value (normalizeKey of its label) or a yes/no boolean. */
export type SchemaValue = string | boolean;

export type SchemaGate =
  /** Another schema field's answer. The field must be earlier and visible. */
  | { answer: string; equals: SchemaValue | readonly SchemaValue[] }
  /** The record's audience. */
  | { audience: RecordAudienceSource }
  /** The kind in force (layout.effectiveKind). */
  | { kind: InitiativeKind | readonly InitiativeKind[] }
  /** Library record NAMES, compared with normalizeKey. */
  | { records: readonly string[] }
  /** A conditional block the layout attaches. */
  | { block: ConditionalBlockId };

export interface SchemaField {
  /** Unique within the category. Written as attrs.category[key]. */
  key: string;
  label: string;
  type: SchemaFieldType;
  /** Option LABELS; values are normalizeKey(label). single / multi only. */
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
  /** Badge text, e.g. "EVERGREEN". */
  tag?: string;
  gate?: SchemaGate;
  required?: boolean;
  /** Set: the universal form asks this; never rendered or written here. */
  binds?: SchemaBind;
}

export interface SchemaGroup {
  id: string;
  title: string;
  gate?: SchemaGate;
  /** Muted text under the group. */
  note?: string;
  fields: readonly SchemaField[];
}

export interface CategorySchema {
  categoryId: CategoryId;
  groups: readonly SchemaGroup[];
}

/** The draft a schema reads: its own answers and the record's audience. */
export interface SchemaDraft {
  category: Readonly<Record<string, unknown>>;
  audienceSource: RecordAudienceSource;
}

export type SchemaLayout = Pick<FormLayout, "effectiveKind" | "blocks">;

export interface SchemaOption {
  value: string;
  label: string;
}

/** A date answer, the same shape as the universal form's DraftDate. */
export interface SchemaDate {
  value: string | null;
  precision: DatePrecision;
}

/** The group id whose title is not shown as a sub-heading. */
export const CORE_GROUP_ID = "core";

/* ------------------------------------------------------------------ *
 * Options and values
 * ------------------------------------------------------------------ */

/** A field's options as value/label pairs. Empty for non-choice fields. */
export function schemaOptions(field: Pick<SchemaField, "options">): SchemaOption[] {
  return (field.options ?? []).map((label) => ({ value: normalizeKey(label), label }));
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^(\d{4})-(\d{2})(?:-\d{2})?$/;

function realDay(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

type Read =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "ok"; value: unknown };

function isSchemaDate(v: unknown): v is SchemaDate {
  return typeof v === "object" && v !== null && "value" in v && "precision" in v;
}

/** Read one answer against its field type. `ok.value` is what gets written. */
function readAnswer(field: SchemaField, raw: unknown): Read {
  if (raw === null || raw === undefined) return { status: "empty" };
  switch (field.type) {
    case "yesno":
      return typeof raw === "boolean" ? { status: "ok", value: raw } : { status: "invalid" };
    case "single": {
      if (raw === "") return { status: "empty" };
      const ok = typeof raw === "string" && schemaOptions(field).some((o) => o.value === raw);
      return ok ? { status: "ok", value: raw } : { status: "invalid" };
    }
    case "multi": {
      if (!Array.isArray(raw)) return { status: "invalid" };
      const picked = schemaOptions(field)
        .map((o) => o.value)
        .filter((v) => raw.includes(v));
      return picked.length === 0 ? { status: "empty" } : { status: "ok", value: picked };
    }
    case "text": {
      if (typeof raw !== "string") return { status: "invalid" };
      const t = raw.trim();
      return t === "" ? { status: "empty" } : { status: "ok", value: t };
    }
    case "number":
    case "currency": {
      if (typeof raw === "string" && raw.trim() === "") return { status: "empty" };
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
      return Number.isFinite(n) && n >= 0 ? { status: "ok", value: n } : { status: "invalid" };
    }
    case "date": {
      if (!isSchemaDate(raw)) return { status: "invalid" };
      const v = raw.value?.trim() ?? "";
      if (v === "") return { status: "empty" };
      if (raw.precision === "month") {
        const m = MONTH_RE.exec(v);
        const stored = m ? `${m[1]}-${m[2]}-01` : "";
        return m && realDay(stored) ? { status: "ok", value: stored } : { status: "invalid" };
      }
      return DAY_RE.test(v) && realDay(v) ? { status: "ok", value: v } : { status: "invalid" };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Gating
 * ------------------------------------------------------------------ */

const asList = <T>(v: T | readonly T[]): readonly T[] => (Array.isArray(v) ? (v as readonly T[]) : [v as T]);

/** Does `recordName` match one of the gate's names? normalizeKey on both sides. */
export function recordMatches(names: readonly string[], recordName: string): boolean {
  const key = normalizeKey(recordName);
  return key !== "" && names.some((n) => normalizeKey(n) === key);
}

interface GateContext {
  draft: SchemaDraft;
  recordName: string;
  layout: SchemaLayout;
  /** Visible, readable answers so far, for `answer` gates. */
  answered: ReadonlyMap<string, unknown>;
}

function gateOpen(gate: SchemaGate | undefined, ctx: GateContext): boolean {
  if (!gate) return true;
  if ("answer" in gate) {
    if (!ctx.answered.has(gate.answer)) return false;
    const value = ctx.answered.get(gate.answer);
    return asList(gate.equals).some((e) => (Array.isArray(value) ? value.includes(e) : value === e));
  }
  if ("audience" in gate) return ctx.draft.audienceSource === gate.audience;
  if ("kind" in gate) return ctx.layout.effectiveKind !== null && asList(gate.kind).includes(ctx.layout.effectiveKind);
  if ("records" in gate) return recordMatches(gate.records, ctx.recordName);
  return ctx.layout.blocks.some((b) => b.id === gate.block && b.attached);
}

export interface VisibleSchemaGroup {
  group: SchemaGroup;
  fields: readonly SchemaField[];
}

/**
 * The groups that render, each with its rendered fields, in schema order.
 *
 * A field renders when it is not bound, its group's gate is open and its own
 * gate is open. An `answer` gate reads only fields already visible, so a
 * field gated on a hidden field is hidden too. Groups with no rendered field
 * are left out (their note goes with them).
 */
export function visibleSchemaGroups(
  schema: CategorySchema | null | undefined,
  draft: SchemaDraft,
  recordName: string,
  layout: SchemaLayout
): VisibleSchemaGroup[] {
  if (!schema) return [];
  const answered = new Map<string, unknown>();
  const ctx: GateContext = { draft, recordName, layout, answered };
  const out: VisibleSchemaGroup[] = [];
  for (const group of schema.groups) {
    if (!gateOpen(group.gate, ctx)) continue;
    const fields: SchemaField[] = [];
    for (const field of group.fields) {
      if (field.binds || !gateOpen(field.gate, ctx)) continue;
      fields.push(field);
      const read = readAnswer(field, draft.category[field.key]);
      if (read.status === "ok") answered.set(field.key, read.value);
    }
    if (fields.length > 0) out.push({ group, fields });
  }
  return out;
}

/** The rendered fields, flat, in schema order. */
export function visibleSchemaFields(
  schema: CategorySchema | null | undefined,
  draft: SchemaDraft,
  recordName: string,
  layout: SchemaLayout
): SchemaField[] {
  return visibleSchemaGroups(schema, draft, recordName, layout).flatMap((g) => g.fields);
}

/* ------------------------------------------------------------------ *
 * Errors and the written value
 * ------------------------------------------------------------------ */

/** The draftErrors key for a schema field. */
export const schemaErrorKey = (key: string): string => `category.${key}`;

function invalidMessage(field: SchemaField): string {
  switch (field.type) {
    case "number":
    case "currency":
      return "Enter a valid number.";
    case "date":
      return "Enter a valid date.";
    default:
      return "Choose one of the options.";
  }
}

/** Errors for the visible schema fields: required ones unanswered, and unreadable answers. */
export function schemaErrors(
  schema: CategorySchema | null | undefined,
  draft: SchemaDraft,
  recordName: string,
  layout: SchemaLayout
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of visibleSchemaFields(schema, draft, recordName, layout)) {
    const read = readAnswer(field, draft.category[field.key]);
    if (read.status === "invalid") errors[schemaErrorKey(field.key)] = invalidMessage(field);
    else if (read.status === "empty" && field.required) errors[schemaErrorKey(field.key)] = "This question needs an answer.";
  }
  return errors;
}

/**
 * attrs.category: visible, answered fields only. Yes/no as booleans, choices
 * as option values, numbers as numbers, dates as YYYY-MM-DD (month precision
 * as the 1st). Null when nothing is answered.
 */
export function schemaAttrs(
  schema: CategorySchema | null | undefined,
  draft: SchemaDraft,
  recordName: string,
  layout: SchemaLayout
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const field of visibleSchemaFields(schema, draft, recordName, layout)) {
    const read = readAnswer(field, draft.category[field.key]);
    if (read.status === "ok") out[field.key] = read.value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Every field in a schema, bound ones included. */
export const allSchemaFields = (schema: CategorySchema): SchemaField[] => schema.groups.flatMap((g) => g.fields);

/** The schema's copy for a bound universal field, for a renderer that wants it. */
export function boundFieldCopy(
  schema: CategorySchema | null | undefined,
  bind: SchemaBind
): Pick<SchemaField, "label" | "hint" | "placeholder"> | null {
  if (!schema) return null;
  const field = allSchemaFields(schema).find((f) => f.binds === bind);
  return field ? { label: field.label, hint: field.hint, placeholder: field.placeholder } : null;
}

/* ------------------------------------------------------------------ *
 * The schemas
 *
 * RECORD NAMES ARE THE LIBRARY'S, read from wb_initiative_library, not the
 * transcription's shorthand: "Dinners" is "Dinners/Lunches", "Challenge /
 * Bootcamp" is two records (Free and Paid), and so on. A shorthand name would
 * match nothing and the gated questions would never show.
 * ------------------------------------------------------------------ */

const YES_CONFIRMED_INVITING_NO = ["Yes, confirmed", "Yes, inviting", "No"] as const;
const BOOKED_PITCHING = ["Booked", "Still pitching"] as const;
const AGREEMENT = ["Sell", "Collect leads", "Mention only"] as const;
const WHOSE_LIST = ["Theirs", "Yours", "Both"] as const;
const SHOW_FORMAT = ["Audio only", "Audio + video"] as const;
const ASK = ["Make an offer", "Drive to calls", "Collect leads"] as const;
const TRAVELING_HINT = "If yes: will you have team on site?";

const CHALLENGE_RECORDS = ["Challenge / Bootcamp (Free)", "Challenge / Bootcamp (Paid)"] as const;

/** Other People's Stages — In-Person records you register for rather than get booked onto. */
export const ROOMS_YOU_JOIN_RECORDS: readonly string[] = Object.freeze([
  "Networking Events",
  "Chamber & Local Business Associations",
  "Mastermind Membership (Someone Else's Room)",
]);

const WEBINARS: CategorySchema = {
  categoryId: "webinars",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        { key: "sessionLength", label: "Session length", type: "text", placeholder: "60 minutes" },
        { key: "platform", label: "Where will it run?", type: "text", placeholder: "Zoom, WebinarJam, EverWebinar..." },
        {
          key: "guests",
          label: "Will you have guest speakers or a co-host?",
          type: "yesno",
          hint: "If yes: have they been confirmed? Will they promote to their list?",
        },
        {
          key: "replay",
          label: "Is there a replay?",
          type: "yesno",
          hint: "Needed because Limited-Time Replay and Replay Scarcity both attach here as maximizers.",
        },
        { key: "replayExpires", label: "Replay expires", type: "date", tag: "IF REPLAY", gate: { answer: "replay", equals: true } },
        {
          key: "vip",
          label: "Paid VIP upgrade?",
          type: "yesno",
          binds: "vip.offered",
          hint: "VIP yes → price, capacity, what's included. Adds a second revenue line.",
        },
      ],
    },
    {
      id: "someone-elses-webinar",
      title: "Someone else's webinar",
      gate: { audience: "borrowed" },
      fields: [
        { key: "spotSecured", label: "Have you already secured the spot?", type: "single", options: BOOKED_PITCHING, binds: "partner.bookingStatus" },
        { key: "host", label: "Who's hosting?", type: "text", placeholder: "Partner, host or affiliate", binds: "partner.host" },
        { key: "revenueSplit", label: "Revenue split", type: "text", placeholder: "e.g. 50 / 50" },
        { key: "agreement", label: "What does your agreement allow?", type: "single", options: AGREEMENT },
        { key: "listEmailed", label: "Whose list is being emailed?", type: "single", options: WHOSE_LIST },
      ],
    },
    {
      id: "your-own-webinar",
      title: "Your own webinar",
      gate: { audience: "own" },
      note: "Revenue lands between cart open and cart close, not on the event date.",
      fields: [
        { key: "cart", label: "Cart opens / closes", type: "date", binds: "cart" },
        { key: "offerTested", label: "Offer tested and converting?", type: "yesno", tag: "EVERGREEN", gate: { kind: "ongoing" } },
        {
          key: "runCadence",
          label: "How often does it run?",
          type: "single",
          options: ["Always-on", "Set times"],
          tag: "EVERGREEN",
          gate: { kind: "ongoing" },
        },
      ],
    },
  ],
};

const FUNNELS: CategorySchema = {
  categoryId: "funnels-launches-promotions",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "promoting",
          label: "What are you promoting?",
          type: "single",
          options: ["Single product", "Bundle", "Store-wide", "Membership", "New cohort"],
        },
        {
          key: "purpose",
          label: "What is the purpose of this funnel?",
          type: "single",
          options: ["Promote a larger initiative", "Grow your list with a free gift", "Sell something"],
        },
        {
          key: "checkoutBuilt",
          label: "Is your funnel or checkout already built?",
          type: "yesno",
          hint: "Yes → is it ready to process payments?",
        },
        { key: "catalogue", label: "Do you have a product catalogue?", type: "yesno" },
        {
          key: "liveEvent",
          label: "Is there a live event in the middle of this?",
          type: "single",
          options: ["Webinar", "Challenge", "Workshop", "None"],
          hint: "This is what makes a launch a launch rather than a campaign — and it's where the cart opens from.",
        },
        { key: "cart", label: "Cart opens / closes", type: "date", binds: "cart" },
        { key: "incentive", label: "Is there a discount, a bonus, or both?", type: "single", options: ["Discount", "Bonus", "Both"] },
        { key: "upsells", label: "Upsell, downsell or order bump?", type: "multi", options: ["Upsell", "Downsell", "Order bump"] },
        { key: "offerTested", label: "Offer tested and converting?", type: "yesno" },
        {
          key: "callsOrOffer",
          label: "Offering calls, or straight to the offer?",
          type: "single",
          options: ["Book a call", "Straight to offer"],
          tag: "VSL",
          gate: { records: ["VSL / Sales Page"] },
        },
      ],
    },
    {
      id: "partners",
      title: "When partners are involved",
      gate: { block: "affiliate" },
      note: "The Affiliate block, not the Partner block — many partners, no single host.",
      fields: [
        { key: "partnerCount", label: "How many partners are you recruiting?", type: "number", binds: "affiliate.partnerCount" },
        { key: "commissionRate", label: "Commission rate", type: "text", binds: "affiliate.terms" },
        { key: "affiliatePortal", label: "Affiliate portal?", type: "yesno" },
        { key: "partnerManager", label: "Who manages partners?", type: "text", placeholder: "Affiliate manager" },
      ],
    },
  ],
};

const SPONSORSHIP_RECORDS = ["Event Sponsorship & Exhibitor Sales"] as const;

const OWN_EVENT_IN_PERSON: CategorySchema = {
  categoryId: "your-own-event-in-person",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "eventType",
          label: "What kind of event is this?",
          type: "single",
          options: ["One-day intensive", "Multi-day", "Hybrid", "In-store", "Grand opening", "Dinner"],
        },
        { key: "venue", label: "Have you secured a venue?", type: "single", options: ["Confirmed", "Shortlist", "Not yet"] },
        { key: "capacity", label: "Room capacity target", type: "number", placeholder: "e.g. 150" },
        {
          key: "entry",
          label: "Free to attend or ticketed?",
          type: "single",
          options: ["Free", "Ticketed"],
          hint: "Ticketed → what tiers? (GA, VIP, virtual) Early-bird or price ladder?",
        },
        { key: "speakers", label: "Guest speakers?", type: "single", options: YES_CONFIRMED_INVITING_NO },
        { key: "sponsorships", label: "Selling sponsorships?", type: "yesno" },
        {
          key: "shipping",
          label: "Shipping anything to attendees or the venue?",
          type: "yesno",
          hint: "Drives the Physical Box Shipping Deadline maximizer — a real cutoff makes an honest deadline.",
        },
        { key: "traveling", label: "Are you traveling to this?", type: "yesno", hint: TRAVELING_HINT },
      ],
    },
    {
      id: "type-extras",
      title: "Type extras",
      fields: [
        {
          key: "dinnerPurpose",
          label: "What is the purpose of this dinner?",
          type: "single",
          options: ["Networking", "Fill an affiliate promo", "Sell a high-end offer"],
          tag: "DINNERS",
          gate: { records: ["Dinners/Lunches"] },
        },
        {
          key: "sponsorshipSelling",
          label: "What are you selling?",
          type: "single",
          options: ["Sponsorships", "Exhibitor booths", "Both"],
          tag: "SPONSORSHIP SALES",
          gate: { records: SPONSORSHIP_RECORDS },
        },
        {
          key: "sponsorshipTiers",
          label: "Tiers and what's in each",
          type: "text",
          placeholder: "Gold / Silver / Bronze...",
          tag: "SPONSORSHIP SALES",
          gate: { records: SPONSORSHIP_RECORDS },
        },
      ],
    },
  ],
};

const OWN_SUMMIT_RECORDS = ["Your Own Virtual Summit"] as const;

const OWN_EVENT_VIRTUAL: CategorySchema = {
  categoryId: "your-own-event-virtual",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        { key: "ask", label: "What's the ask?", type: "single", options: ASK, binds: "conversionPath" },
        { key: "platform", label: "Where will it run?", type: "text", placeholder: "Zoom, Skool, YouTube Live..." },
        { key: "guests", label: "Guests or co-hosts?", type: "single", options: YES_CONFIRMED_INVITING_NO },
      ],
    },
    {
      id: "dated-events",
      title: "Dated events",
      gate: { records: [...CHALLENGE_RECORDS, ...OWN_SUMMIT_RECORDS, "Hybrid Events"] },
      fields: [
        { key: "days", label: "How many days?", type: "number", placeholder: "5" },
        { key: "sessionLength", label: "Session length", type: "text", placeholder: "60 min" },
        { key: "entry", label: "Free or paid entry?", type: "single", options: ["Free", "Paid"] },
        {
          key: "vip",
          label: "Paid VIP upgrade?",
          type: "yesno",
          binds: "vip.offered",
          hint: "VIP is sold during registration and pitched again on day 1 — same window as entry, different curve.",
        },
        // NOT ON THE CHALLENGE RECORDS: they ask "Pitch day" as a date type
        // extra (type-extras.ts), which also sets when the cart opens. One
        // question per record, so the schema keeps it only where no extra does.
        {
          key: "pitchDay",
          label: "Pitch day",
          type: "text",
          placeholder: "Day 5 — when the offer opens",
          gate: { records: [...OWN_SUMMIT_RECORDS, "Hybrid Events"] },
        },
        { key: "registrationCloses", label: "Registration closes", type: "text", placeholder: "Day 2 of the challenge" },
        { key: "cart", label: "Cart opens / closes", type: "date", binds: "cart" },
        { key: "speakerCount", label: "How many speakers?", type: "number", tag: "SUMMIT", gate: { records: OWN_SUMMIT_RECORDS } },
        { key: "speakersPromote", label: "Speakers promote to their lists?", type: "yesno", tag: "SUMMIT", gate: { records: OWN_SUMMIT_RECORDS } },
      ],
    },
    {
      id: "shows",
      title: "Shows that keep running",
      gate: { records: ["Podcast / Vodcast", "Your Own YouTube Channel", "Social Media Lives"] },
      fields: [
        {
          key: "showPurpose",
          label: "What is the purpose of this show?",
          type: "single",
          options: ["Promote a larger initiative", "Sell something", "Audience growth"],
        },
        { key: "cadence", label: "How often does it go out?", type: "single", options: ["Weekly", "Fortnightly", "Monthly"] },
        { key: "showFormat", label: "Format", type: "single", options: SHOW_FORMAT },
      ],
    },
  ],
};

const OPS_IN_PERSON: CategorySchema = {
  categoryId: "other-peoples-stages-in-person",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "ask",
          label: "What's the ask?",
          type: "single",
          options: ASK,
          binds: "conversionPath",
          hint: "If offering: new or existing product? If collecting leads: virtually or in print?",
        },
        { key: "talkCrafted", label: "Have you crafted your talk?", type: "single", options: ["Yes", "Not yet"] },
        { key: "deck", label: "Do you have a deck?", type: "single", options: ["Yes", "No", "Don't need one"] },
        {
          key: "booth",
          label: "Will you have a booth or table?",
          type: "yesno",
          hint: "If yes: what assets are you printing? Will you be booking appointments on site?",
        },
        { key: "traveling", label: "Are you traveling to this?", type: "yesno", hint: TRAVELING_HINT },
      ],
    },
    {
      id: "their-room",
      title: "Because it is their room",
      note: "Networking, chamber and mastermind membership set is it booked? off — you register, you don't get booked.",
      fields: [
        {
          key: "stageSecured",
          label: "Have you already secured the stage?",
          type: "single",
          options: BOOKED_PITCHING,
          binds: "partner.bookingStatus",
          hint: "If not: do you have a list of the stages you want to target?",
        },
        { key: "host", label: "Who's hosting?", type: "text", binds: "partner.host" },
        { key: "presenting", label: "In person or presenting remotely?", type: "single", options: ["In person", "Remotely"], binds: "format" },
        { key: "elevatorPitch", label: "Elevator pitch ready?", type: "yesno", tag: "ROOMS YOU JOIN", gate: { records: ROOMS_YOU_JOIN_RECORDS } },
        {
          key: "businessCard",
          label: "Business card",
          type: "single",
          options: ["Virtual", "Printed"],
          tag: "ROOMS YOU JOIN",
          gate: { records: ROOMS_YOU_JOIN_RECORDS },
        },
      ],
    },
  ],
};

const OPS_SUMMIT_RECORDS = ["Virtual Summit (as Speaker)"] as const;

const OPS_VIRTUAL: CategorySchema = {
  categoryId: "other-peoples-stages-virtual",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "spotSecured",
          label: "Have you already secured the spot?",
          type: "single",
          options: BOOKED_PITCHING,
          binds: "partner.bookingStatus",
          hint: "If not: do you have a list of shows, hosts or summits you want to target?",
        },
        { key: "host", label: "Who's hosting?", type: "text", binds: "partner.host" },
        {
          key: "agreement",
          label: "What does your agreement allow?",
          type: "single",
          options: AGREEMENT,
          hint: "What you can take from this is set by the agreement, not by the format.",
        },
        {
          key: "revenueSplit",
          label: "Revenue split",
          type: "text",
          placeholder: "e.g. 50 / 50",
          tag: "IF SELLING",
          gate: { answer: "agreement", equals: "sell" },
        },
        { key: "listEmailed", label: "Whose list is being emailed?", type: "single", options: WHOSE_LIST },
        {
          key: "callToAction",
          label: "Will you have a call to action?",
          type: "yesno",
          hint: "If yes: to a link, a code, a lead magnet or a booking page?",
        },
      ],
    },
    {
      id: "guesting",
      title: "Guesting on a show",
      gate: { records: ["Podcast / Vodcast Guest", "Guest on Someone's YouTube Channel", "Social Media Lives"] },
      fields: [
        { key: "showFormat", label: "Format", type: "single", options: SHOW_FORMAT },
        { key: "published", label: "Will it be published or live only?", type: "single", options: ["Published", "Live only"] },
      ],
    },
    {
      id: "their-challenge-or-summit",
      title: "Their challenge or summit",
      gate: { records: [...CHALLENGE_RECORDS, ...OPS_SUMMIT_RECORDS] },
      fields: [
        { key: "days", label: "How many days?", type: "number", tag: "CHALLENGE", gate: { records: CHALLENGE_RECORDS } },
        { key: "sessionDate", label: "Your session date and length", type: "text", placeholder: "mm / dd · 60 min" },
        {
          key: "speakerCount",
          label: "How many speakers?",
          type: "number",
          tag: "SUMMIT",
          gate: { records: OPS_SUMMIT_RECORDS },
          hint: "Are you expected to promote it to your list? That is often the price of the slot.",
        },
      ],
    },
  ],
};

const YES_NO_NOT_SURE = ["Yes", "No", "Not sure"] as const;

/** Paid Ads placements bought from a person: a host and a booking. */
const BOUGHT_PLACEMENT_RECORDS = ["Podcast Ads", "Newsletter Ads"] as const;

const PAID_ADS: CategorySchema = {
  categoryId: "paid-ads",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "purpose",
          label: "What is the purpose of your ads?",
          type: "single",
          options: ["Registrations to an event", "Promote a larger initiative", "Fill an affiliate promo", "Sell something directly"],
        },
        { key: "budget", label: "Total ad budget", type: "currency", binds: "plannedBudget" },
        { key: "destination", label: "Where is the traffic going?", type: "single", options: ["Landing page", "Sales page", "Booking page"] },
        {
          key: "creative",
          label: "Do you have creative ready?",
          type: "single",
          options: ["Ready", "Needs making"],
          hint: "If making: video, static, or both? Churn on ad creative is high, so the task list plans for weekly refresh.",
        },
        {
          key: "pixel",
          label: "Is your pixel installed and tracking?",
          type: "single",
          options: YES_NO_NOT_SURE,
          hint: "Easy to skip and expensive to skip — without it nothing downstream is measurable.",
        },
      ],
    },
    {
      id: "bought-placements",
      title: "Bought placements",
      gate: { records: BOUGHT_PLACEMENT_RECORDS },
      note: "Placements bought from a person — there's a host and a booking, so the Partner block applies.",
      fields: [
        { key: "placedBy", label: "Who's placing this?", type: "single", options: ["You", "A partner", "An agency"] },
        { key: "placementBooked", label: "Have you booked the placement?", type: "single", options: ["Booked", "Negotiating"], binds: "partner.bookingStatus" },
      ],
    },
    {
      id: "platforms",
      title: "Platform is an input, not an assumption",
      fields: [
        {
          key: "platforms",
          label: "Platforms",
          type: "multi",
          options: ["Meta", "IG Reels", "IG Feed", "YouTube", "Google", "Pinterest", "LinkedIn"],
          binds: "adPlatforms",
        },
      ],
    },
  ],
};

/** Sales & Outreach records that send cold messages from a domain or number. */
const COLD_OUTREACH_RECORDS = ["Cold Email / LinkedIn Outbound", "Direct Message Reach Out"] as const;

const SALES_OUTREACH: CategorySchema = {
  categoryId: "sales-outreach",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "purpose",
          label: "What is the purpose of this outreach?",
          type: "single",
          options: ["Book calls", "Fill an event", "Re-engage past clients", "Renew or rebill", "General connection"],
        },
        { key: "onList", label: "Who is on the list?", type: "single", options: ["Warm contacts", "Past clients", "Cold"], hint: "Roughly how many?" },
        { key: "listSize", label: "List size", type: "number", placeholder: "e.g. 400" },
        { key: "channel", label: "Channel", type: "single", options: ["Phone", "SMS", "Email", "LinkedIn", "IG DM"] },
        {
          key: "outreachBy",
          label: "Who is doing the outreach?",
          type: "single",
          options: ["You", "Setters", "Closers", "A team"],
          hint: "If a team: how many reps? What's the commission structure?",
        },
        { key: "scriptReady", label: "Script or opening message ready?", type: "yesno" },
        { key: "crmReady", label: "CRM and calendar in place?", type: "yesno" },
        {
          key: "sendingWarmed",
          label: "Sending domain or number warmed up?",
          type: "single",
          options: YES_NO_NOT_SURE,
          tag: "COLD EMAIL / SMS",
          gate: { records: COLD_OUTREACH_RECORDS },
        },
      ],
    },
    {
      id: "no-cart",
      title: "The one path that has no cart",
      fields: [
        {
          key: "close",
          label: "When does this round of calls close?",
          type: "date",
          binds: "close",
          hint: "The one case where the close date can't be derived — it has to be entered.",
        },
      ],
    },
    {
      id: "call-source",
      title: "Where did the calls come from?",
      fields: [
        {
          key: "source",
          label: "Where did the calls come from?",
          type: "single",
          options: ["VSL", "Webinar", "Evergreen promo", "Email promo", "Outbound", "Referral"],
          required: true,
          hint: "This is the only category where the source has to be asked outright — the projection has nothing usable behind it otherwise.",
        },
      ],
    },
  ],
};

const SMS_RECORDS = ["Your Own SMS / Text Community", "SMS / Text Campaign"] as const;
const DIRECT_MAIL_RECORDS = ["Direct Mail"] as const;

const EMAIL_TEXT_MAIL: CategorySchema = {
  categoryId: "email-text-mail",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "purpose",
          label: "What is the purpose of this campaign?",
          type: "single",
          options: ["Promote a larger initiative", "Re-engage an existing list", "Sell something", "Offer a free gift"],
        },
        { key: "hasList", label: "Do you have a list?", type: "yesno" },
        { key: "listSize", label: "Roughly how big?", type: "number", placeholder: "e.g. 12,000", gate: { answer: "hasList", equals: true } },
        {
          key: "warmth",
          label: "How warm is it?",
          type: "single",
          options: ["Active buyers", "Engaged", "Cold / lapsed"],
          hint: "Results scale with list size and warmth. One without the other projects badly.",
        },
        { key: "touches", label: "How many touches?", type: "text", placeholder: "4 – 8 emails" },
        { key: "window", label: "Over what window?", type: "text", placeholder: "e.g. 10 days" },
        {
          key: "sendMode",
          label: "Broadcast or automation?",
          type: "single",
          options: ["Broadcast", "Automation"],
          hint: "Automation schedules ahead; broadcast keeps flexibility if the copy or funnel changes mid-promo.",
        },
      ],
    },
    {
      id: "sms-compliance",
      title: "SMS only — compliance gate",
      gate: { records: SMS_RECORDS },
      note:
        "These are blocking, not informational. A2P verification takes real time and varies by state — Texas is the strictest. An SMS initiative dated before verification clears cannot run.",
      fields: [
        { key: "textingService", label: "Do you have a texting service?", type: "single", options: ["Skipio", "Twilio", "Other", "None yet"] },
        { key: "textConsent", label: "Has your list explicitly agreed to texts?", type: "yesno" },
        { key: "tenDlc", label: "10DLC business number?", type: "single", options: ["Yes", "No", "Don't know"] },
        { key: "carrierVerified", label: "Verified with the carriers?", type: "yesno" },
        { key: "govCompliant", label: "Compliant with government standards?", type: "single", options: ["Yes", "Not sure"] },
      ],
    },
    {
      id: "direct-mail",
      title: "Direct mail only",
      gate: { records: DIRECT_MAIL_RECORDS },
      fields: [
        { key: "mailPiece", label: "What are you sending?", type: "single", options: ["Postcard", "Letter", "Package"] },
        { key: "mailService", label: "Direct mail service?", type: "yesno" },
        {
          key: "mailTargets",
          label: "Do you know which neighbourhoods or segments you're targeting?",
          type: "text",
          placeholder: "Postcodes, past buyers, corporate contacts...",
          hint: "Cost per piece means this only works on tight, high-value segments.",
        },
      ],
    },
  ],
};

const ORGANIC_SOCIAL_RECORDS = ["Organic Social"] as const;
const SEO_RECORDS = ["SEO & AI Search"] as const;
const NEWSLETTER_RECORDS = ["Your Own Newsletter"] as const;
const LOCAL_PR_RECORDS = ["Local PR & Community Media"] as const;

const CONTENT_MEDIA: CategorySchema = {
  categoryId: "content-media",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "purpose",
          label: "What is this publishing meant to do?",
          type: "single",
          options: ["Promote a larger initiative", "Grow the list with a free gift", "Sell something", "Audience growth"],
        },
        { key: "cadence", label: "How often will you publish?", type: "single", options: ["Daily", "Weekly", "Monthly"] },
        { key: "maker", label: "Who is making it?", type: "single", options: ["You", "A team", "Outsourced"] },
        {
          key: "discovery",
          label: "How will people find it?",
          type: "multi",
          options: ["Ads", "Your email list", "Cross-posting", "The algorithm"],
          hint: "Always-on work with nothing driving it is the most common way a channel stalls.",
        },
      ],
    },
    {
      id: "type-extras",
      title: "Type extras",
      fields: [
        {
          key: "socialPlatforms",
          label: "Which platforms are you on?",
          type: "multi",
          options: ["Instagram", "LinkedIn", "Facebook", "TikTok", "X", "YouTube Shorts"],
          tag: "ORGANIC SOCIAL",
          gate: { records: ORGANIC_SOCIAL_RECORDS },
          hint: "And which do you want to start? Starting a platform is a different amount of work from maintaining one.",
        },
        {
          key: "searchAssets",
          label: "Which of these do you have?",
          type: "multi",
          options: ["Blog", "Website", "YouTube", "Google Business Profile", "Directory listings", "Public reviews"],
          tag: "SEO & AI SEARCH",
          gate: { records: SEO_RECORDS },
        },
        {
          key: "keywords",
          label: "Target keywords",
          type: "text",
          placeholder: "Top keywords & phrases",
          tag: "SEO & AI SEARCH",
          gate: { records: SEO_RECORDS },
        },
        {
          key: "listSize",
          label: "List size",
          type: "number",
          placeholder: "e.g. 12,000",
          tag: "NEWSLETTER",
          gate: { records: NEWSLETTER_RECORDS },
        },
        {
          key: "newsAngle",
          label: "Hook or news angle",
          type: "text",
          placeholder: "Announcement, data, milestone...",
          tag: "LOCAL PR",
          gate: { records: LOCAL_PR_RECORDS },
        },
        {
          key: "pressKit",
          label: "Press kit ready?",
          type: "yesno",
          tag: "LOCAL PR",
          gate: { records: LOCAL_PR_RECORDS },
          hint: "Press kit means bio, headshots, boilerplate and past coverage. Local outlets want all four before they will run anything.",
        },
      ],
    },
  ],
};

const SPONSORSHIP_ASSET_RECORDS = ["Sponsorship Sales on Your Own Assets"] as const;
const INFLUENCER_RECORDS = ["Influencer Marketing"] as const;

const PARTNERSHIPS_REFERRALS: CategorySchema = {
  categoryId: "partnerships-referrals",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "commission",
          label: "Commission or fee you're willing to pay",
          type: "text",
          placeholder: "e.g. 40% / $500 flat",
          binds: "affiliate.terms",
        },
        { key: "compensation", label: "How are they compensated?", type: "single", options: ["Commission", "Flat fee", "Product", "Hybrid"] },
        {
          key: "offerTested",
          label: "Is your product tested and converting?",
          type: "yesno",
          hint: "If yes: do you have stats you can share with partners? They will ask, and nobody promotes an untested offer.",
        },
        {
          key: "promotable",
          label: "What can partners promote?",
          type: "single",
          options: ["A specific offer", "An event", "A lead magnet", "Anything"],
        },
        { key: "affiliatePortal", label: "Affiliate portal?", type: "yesno" },
        { key: "partnerManager", label: "Someone to manage partners?", type: "yesno" },
        {
          key: "targetPartners",
          label: "Do you have a list of target partners, or do you need to find them?",
          type: "single",
          options: ["Have a list", "Need to find them"],
        },
      ],
    },
    {
      id: "nine-month",
      title: "The 9-month question",
      fields: [
        {
          key: "planNineMonths",
          label: "Are you willing to plan 9 months in advance?",
          type: "yesno",
          hint: "Partners need advance notice. This is the rare intake question that should change the recommended date, not just record an answer — an affiliate launch dated eight weeks out is already in trouble.",
        },
      ],
    },
    {
      id: "sponsorship-influencer",
      title: "Sponsorship & influencer extensions",
      fields: [
        {
          key: "sponsorshipAsset",
          label: "What asset are you selling sponsorship on?",
          type: "single",
          options: ["Event", "Podcast", "Newsletter", "Community"],
          tag: "SPONSORSHIP",
          gate: { records: SPONSORSHIP_ASSET_RECORDS },
          hint: "Do you have audience numbers and a media kit? What tiers, and what's in each?",
        },
        {
          key: "creative",
          label: "Will you provide creative?",
          type: "single",
          options: ["You provide", "They make it"],
          tag: "INFLUENCER",
          gate: { records: INFLUENCER_RECORDS },
        },
        { key: "approvalRights", label: "Approval rights before posting?", type: "yesno", tag: "INFLUENCER", gate: { records: INFLUENCER_RECORDS } },
        {
          key: "tracking",
          label: "Tracking with unique links or codes?",
          type: "single",
          options: ["Links", "Codes", "Both"],
          tag: "INFLUENCER",
          gate: { records: INFLUENCER_RECORDS },
        },
      ],
    },
  ],
};

const LOCAL_PRESENCE: CategorySchema = {
  categoryId: "local-presence",
  groups: [
    {
      id: CORE_GROUP_ID,
      title: "Core",
      fields: [
        {
          key: "haveAlready",
          label: "Which of these do you already have?",
          type: "multi",
          options: ["Google Business Profile", "Yelp", "Directory listings", "Public reviews", "None of these"],
        },
        {
          key: "napConsistent",
          label: "Is your business information consistent everywhere?",
          type: "single",
          options: YES_NO_NOT_SURE,
          hint: "Name, address, phone, hours. Inconsistency is the single most common reason local ranking stalls.",
        },
        { key: "photos", label: "Do you have photos of your business, team and work?", type: "single", options: ["Yes", "Some", "No"] },
        { key: "reviewCount", label: "Roughly how many reviews now?", type: "number", placeholder: "e.g. 24" },
        { key: "respondsToReviews", label: "Do you respond to reviews?", type: "single", options: ["Always", "Sometimes", "No"] },
        { key: "reviewProcess", label: "Do you have a process for asking customers for reviews?", type: "yesno" },
        {
          key: "serviceArea",
          label: "Do you serve customers at a location, or travel to them?",
          type: "single",
          options: ["At a location", "We travel", "Both"],
          hint: "Changes what can be claimed and how the service area is set.",
        },
      ],
    },
  ],
};

/** Every schema, by category. Categories without one render no schema slot. */
export const CATEGORY_SCHEMAS: Readonly<Partial<Record<CategoryId, CategorySchema>>> = Object.freeze({
  webinars: WEBINARS,
  "funnels-launches-promotions": FUNNELS,
  "your-own-event-in-person": OWN_EVENT_IN_PERSON,
  "your-own-event-virtual": OWN_EVENT_VIRTUAL,
  "other-peoples-stages-in-person": OPS_IN_PERSON,
  "other-peoples-stages-virtual": OPS_VIRTUAL,
  "paid-ads": PAID_ADS,
  "sales-outreach": SALES_OUTREACH,
  "email-text-mail": EMAIL_TEXT_MAIL,
  "content-media": CONTENT_MEDIA,
  "partnerships-referrals": PARTNERSHIPS_REFERRALS,
  "local-presence": LOCAL_PRESENCE,
});

/** The categories that have a schema. */
export const SCHEMA_CATEGORY_IDS: readonly CategoryId[] = Object.freeze(
  Object.keys(CATEGORY_SCHEMAS) as CategoryId[]
);

/** The schema for a category, or null when it has none. */
export const schemaFor = (id: CategoryId): CategorySchema | null => CATEGORY_SCHEMAS[id] ?? null;
