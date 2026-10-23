/**
 * The spec's type extras: the per-initiative questions, beyond the universal
 * form and the category schema, that something downstream actually reads.
 *
 * ONE TABLE, TWO READERS. `deriveConfig` seeds these as the starting
 * `fieldExtras` for a record with no saved row, and
 * scripts/backfill-type-extras.mts fills them into rows the seed already wrote
 * with `[]`. Both match on the library record's NAME through normalizeKey, the
 * same way the category schemas' record gates match, because the library has
 * several rows per name (Challenge / Bootcamp exists in both virtual
 * categories; Dinners/Lunches in both in-person ones) and the spec rules per
 * name, not per row.
 *
 * Every list here is at most MAX_FIELD_EXTRAS long (asserted in the tests).
 *
 * PURE. No database, no network, no React.
 */

import { normalizeKey } from "../workbook/parse";
import { MAX_FIELD_EXTRAS, type FieldExtra } from "./library-config";

const PITCH_DAY: FieldExtra = Object.freeze({
  key: "pitch_day",
  label: "Pitch day",
  type: "date",
  derives: "cart.opens",
  readBy: "Cart opens: the cart opens on pitch day unless the user changes it.",
  hint: "The day the offer opens.",
});

const WEBINAR_DATE: FieldExtra = Object.freeze({
  key: "webinar_date",
  label: "Webinar date",
  type: "date",
  derives: "cart.opens",
  readBy: "Cart opens: the cart opens on the webinar date unless the user changes it.",
});

/** The note on both of Affiliate Launch's cart fields. */
export const OFFER_OWNER_CART_NOTE = "Set by the offer owner — enter them as they gave them to you.";

const AFFILIATE_CART_OPENS: FieldExtra = Object.freeze({
  key: "offer_owner_cart_opens",
  label: "Cart opens",
  type: "date",
  binds: "cart.opens",
  readBy: "Cart opens (revenue window); the offer owner sets it.",
  hint: OFFER_OWNER_CART_NOTE,
});

const AFFILIATE_CART_CLOSES: FieldExtra = Object.freeze({
  key: "offer_owner_cart_closes",
  label: "Cart closes",
  type: "date",
  binds: "dates.close",
  readBy: "Close date (revenue window); the offer owner sets it.",
  hint: OFFER_OWNER_CART_NOTE,
});

const GUEST_LIST_SIZE: FieldExtra = Object.freeze({
  key: "guest_list_size",
  label: "Guest list size",
  type: "number",
  readBy: "Task list and projection: how many seats to fill.",
});

const QUALIFYING_CRITERIA: FieldExtra = Object.freeze({
  key: "qualifying_criteria",
  label: "Qualifying criteria",
  type: "text",
  readBy: "Invite tasks: who qualifies for a seat.",
});

/**
 * Library record NAME → its extras. Names are the library's own spelling
 * (read from wb_initiative_library), compared with normalizeKey.
 */
export const TYPE_EXTRAS_BY_NAME: Readonly<Record<string, readonly FieldExtra[]>> = Object.freeze({
  "Challenge / Bootcamp (Free)": Object.freeze([PITCH_DAY]),
  "Challenge / Bootcamp (Paid)": Object.freeze([PITCH_DAY]),
  "Internal Launch": Object.freeze([WEBINAR_DATE]),
  "Affiliate Launch": Object.freeze([AFFILIATE_CART_OPENS, AFFILIATE_CART_CLOSES]),
  "Dinners/Lunches": Object.freeze([GUEST_LIST_SIZE, QUALIFYING_CRITERIA]),
});

const BY_KEY: ReadonlyMap<string, readonly FieldExtra[]> = new Map(
  Object.entries(TYPE_EXTRAS_BY_NAME).map(([name, extras]) => [normalizeKey(name), extras])
);

/** Fresh copies of the extras for a record name, or null when it has none. */
export function typeExtrasFor(name: unknown): FieldExtra[] | null {
  const key = normalizeKey(name);
  const extras = key === "" ? undefined : BY_KEY.get(key);
  if (!extras) return null;
  // Copies, capped: a caller that edits the result must not edit the table.
  return extras.slice(0, MAX_FIELD_EXTRAS).map((e) => ({ ...e }));
}

/* ------------------------------------------------------------------ *
 * Backfill planning
 * ------------------------------------------------------------------ */

export interface BackfillLibraryRow {
  initiative_key: string;
  name: string | null;
}

export interface BackfillConfigRow {
  initiative_key: string;
  field_extras: unknown;
}

export interface BackfillUpdate {
  initiativeKey: string;
  name: string;
  fieldExtras: FieldExtra[];
}

export type BackfillSkipReason =
  /** The row already has extras: someone configured it. Never touched. */
  | "has_extras"
  /** field_extras is not an array (cannot happen under 045's CHECK). */
  | "not_an_array"
  /** The library record has no config row yet; seeding will derive it. */
  | "no_config_row";

export interface BackfillPlan {
  updates: BackfillUpdate[];
  skipped: { initiativeKey: string; name: string; reason: BackfillSkipReason }[];
}

/**
 * Which config rows the backfill would write, and with what.
 *
 * ONLY rows whose field_extras is an EMPTY ARRAY and whose library name is in
 * TYPE_EXTRAS_BY_NAME. A non-empty array is an admin's decision and is
 * reported, never replaced. Running the plan again after it is applied finds
 * nothing to do.
 */
export function planTypeExtrasBackfill(
  library: readonly BackfillLibraryRow[],
  configs: readonly BackfillConfigRow[]
): BackfillPlan {
  const byKey = new Map(configs.map((c) => [c.initiative_key, c]));
  const plan: BackfillPlan = { updates: [], skipped: [] };
  for (const lib of library) {
    const extras = typeExtrasFor(lib.name);
    if (!extras) continue;
    const name = String(lib.name);
    const row = byKey.get(lib.initiative_key);
    if (!row) plan.skipped.push({ initiativeKey: lib.initiative_key, name, reason: "no_config_row" });
    else if (!Array.isArray(row.field_extras)) {
      plan.skipped.push({ initiativeKey: lib.initiative_key, name, reason: "not_an_array" });
    } else if (row.field_extras.length > 0) {
      plan.skipped.push({ initiativeKey: lib.initiative_key, name, reason: "has_extras" });
    } else plan.updates.push({ initiativeKey: lib.initiative_key, name, fieldExtras: extras });
  }
  return plan;
}
