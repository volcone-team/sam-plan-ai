/**
 * A STARTING POINT for one record's LibraryRecordConfig, derived from the
 * wb_initiative_library row it configures.
 *
 * WHAT THIS IS FOR: the admin editor opens 87 unconfigured records. Most of
 * what it needs can be read straight off the workbook row (category, own/ops,
 * the CTA column, a handful of names the spec rules on). This module reads
 * those, says which fields it filled, which a human still has to decide, and
 * warns — with stable codes — wherever it had to read something it was not
 * sure about.
 *
 * WHAT IT IS NOT: a source of defaults. Two rules keep it honest:
 *
 *   1. NEVER FABRICATE AN EMPTY ARRAY. `allowedPaths: []` reads as "this
 *      record offers no paths", which is a decision; an unset field reads as
 *      "nobody has decided", which is the truth. Every array field here is
 *      either derived from real data or left unset.
 *   2. `allowedKinds` IS NEVER DERIVED. Nothing in the workbook says whether
 *      an initiative is one-time, recurring or ongoing, and a single default
 *      kind would silently SUPPRESS the Kind question on every record (see
 *      resolveFormLayout). That is precisely the failure the contract warns
 *      about.
 *
 * `isLaunch` IS NOT DERIVED EITHER: picker visibility is now
 * initiative_settings.is_active, so this module has no opinion on it.
 *
 * PURE. No database, no network, no React. Imports only the contract module,
 * the (pure) type-extras table and `normalizeKey` from the (pure) workbook
 * parser, which the contract uses too.
 */

import {
  CONVERSION_PATHS,
  DEFAULT_PARTNER_BLOCK,
  resolveCategory,
  resolveRecordAudience,
  type CategoryId,
  type ConversionPath,
  type LibraryRecordConfig,
} from "./library-config";
import { normalizeKey } from "../workbook/parse";
import { typeExtrasFor } from "./type-extras";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** The columns of a wb_initiative_library row this module reads. */
export interface LibraryRowInput {
  initiative_key: string;
  name: string | null;
  category: string | null;
  own_or_ops: string | null;
  cta_options: readonly string[] | null;
}

/**
 * The derived config.
 *
 * `categoryId` is not on LibraryRecordConfig (the contract carries the
 * resolved category alongside, not inside, the config) but it IS a column of
 * initiative_library_config, so the editor needs it as a starting value too.
 */
export type DerivedConfig = Partial<LibraryRecordConfig> & {
  initiativeKey: string;
  categoryId?: CategoryId;
};

/** Every configurable field this module reports on. `isLaunch` is deliberately absent. */
export type ConfigField =
  | "categoryId"
  | "audienceSource"
  | "allowedPaths"
  | "allowedKinds"
  | "formatOverride"
  | "partnerBlock"
  | "ongoingLabel"
  | "revenueLines"
  | "fieldExtras"
  | "allowedFrequencies";

export const CONFIG_FIELDS: readonly ConfigField[] = Object.freeze([
  "categoryId",
  "audienceSource",
  "allowedPaths",
  "allowedKinds",
  "formatOverride",
  "partnerBlock",
  "ongoingLabel",
  "revenueLines",
  "fieldExtras",
  "allowedFrequencies",
]);

/**
 * Stable warning codes. Tests and the admin editor switch on these; the
 * message text is for people and may change.
 */
export type DeriveWarningCode =
  /** The category cell was blank. categoryId left unset. */
  | "category_empty"
  /** The category cell did not match any of the twelve. categoryId left unset. */
  | "category_unknown"
  /** No category, so audience could not be resolved. audienceSource left unset. */
  | "audience_unresolved"
  /** own_or_ops blank or unreadable; audienceSource came from the category fallback. */
  | "audience_fallback"
  /** A CTA token that maps to no conversion path. Not dropped silently: reported here. */
  | "cta_unknown_token"
  /** CTA tokens present but none mapped. allowedPaths left unset rather than []. */
  | "cta_no_known_paths"
  /** partnerBlock.booking set false because the NAME contains "networking". */
  | "booking_name_matched";

export interface DeriveWarning {
  code: DeriveWarningCode;
  initiativeKey: string;
  field: ConfigField;
  message: string;
  /** The raw value that caused it, where there is one. */
  value?: string;
}

export interface DeriveResult {
  config: DerivedConfig;
  /** Fields set from the row, in CONFIG_FIELDS order. */
  derived: readonly ConfigField[];
  /** Fields a human must still decide, in CONFIG_FIELDS order. */
  needsHuman: readonly ConfigField[];
  warnings: readonly DeriveWarning[];
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/**
 * The workbook's CTA vocabulary, keyed by normalizeKey so case, spacing and
 * punctuation do not matter ("Drive to Calls", "drive-to-calls").
 */
const CTA_TOKEN_TO_PATH: ReadonlyMap<string, ConversionPath> = new Map([
  [normalizeKey("Offer"), "offer"],
  [normalizeKey("Drive to Calls"), "calls"],
  [normalizeKey("Lead Collect"), "leads"],
  [normalizeKey("Speaker Fee"), "speaker-fee"],
]);

/** The record the spec pins to hybrid. Matched on the normalised whole name. */
const HYBRID_EVENTS_KEY = normalizeKey("Hybrid Events");

/** "networking" as a whole word, any case. "Networking Event" yes, "Netw0rking"/"networkingly" no. */
const NETWORKING_WORD = /\bnetworking\b/i;

/**
 * Fields no workbook column can answer. Always reported as needing a human
 * (unless derived, which for these never happens).
 *
 * `allowedFrequencies` belongs here because it is only meaningful once a human
 * has allowed `recurring`. `ongoingLabel`, `fieldExtras` and `formatOverride`
 * are NOT here: each is optional with a sound absent state (default label, no
 * extras, category decides format).
 */
const ALWAYS_HUMAN: ReadonlySet<ConfigField> = new Set<ConfigField>([
  "allowedKinds",
  "revenueLines",
  "allowedFrequencies",
]);

/** Fields that need a human whenever derivation left them unset. */
const HUMAN_IF_UNSET: ReadonlySet<ConfigField> = new Set<ConfigField>([
  "categoryId",
  "audienceSource",
  "allowedPaths",
]);

function derivePaths(
  cta: readonly string[] | null,
  initiativeKey: string,
  warn: (w: Omit<DeriveWarning, "initiativeKey">) => void
): ConversionPath[] | undefined {
  const tokens = (cta ?? []).map((t) => String(t ?? "").trim()).filter((t) => t !== "");
  if (tokens.length === 0) return undefined;

  const found = new Set<ConversionPath>();
  for (const token of tokens) {
    const path = CTA_TOKEN_TO_PATH.get(normalizeKey(token));
    if (path) {
      found.add(path);
    } else {
      warn({
        code: "cta_unknown_token",
        field: "allowedPaths",
        value: token,
        message: `CTA option "${token}" on ${initiativeKey} maps to no conversion path.`,
      });
    }
  }
  if (found.size === 0) {
    warn({
      code: "cta_no_known_paths",
      field: "allowedPaths",
      message: `None of the CTA options on ${initiativeKey} map to a conversion path; allowedPaths left unset.`,
    });
    return undefined;
  }
  // Contract order, not workbook order, so two rows with the same CTAs compare equal.
  return CONVERSION_PATHS.filter((p) => found.has(p));
}

/* ------------------------------------------------------------------ *
 * Single record
 * ------------------------------------------------------------------ */

export function deriveConfig(row: LibraryRowInput): DeriveResult {
  const initiativeKey = row.initiative_key;
  const config: DerivedConfig = { initiativeKey };
  const warnings: DeriveWarning[] = [];
  const warn = (w: Omit<DeriveWarning, "initiativeKey">) =>
    warnings.push({ ...w, initiativeKey });
  const name = String(row.name ?? "");

  // Category
  const match = resolveCategory(row.category);
  if (match.ok) {
    config.categoryId = match.category.id;
  } else {
    warn({
      code: match.error === "empty" ? "category_empty" : "category_unknown",
      field: "categoryId",
      value: row.category ?? undefined,
      message: match.message,
    });
  }

  // Audience
  if (match.ok) {
    const ownOrOps = normalizeKey(row.own_or_ops);
    const explicit =
      ownOrOps === "own" || ownOrOps === "ops" || ownOrOps === "own-ops" || ownOrOps === "ops-own";
    config.audienceSource = resolveRecordAudience(row.own_or_ops, match.category);
    if (!explicit) {
      warn({
        code: "audience_fallback",
        field: "audienceSource",
        value: row.own_or_ops ?? undefined,
        message:
          `own_or_ops on ${initiativeKey} is ${row.own_or_ops ? `"${row.own_or_ops}"` : "blank"}; ` +
          `audience "${config.audienceSource}" came from the category fallback.`,
      });
    }
  } else {
    warn({
      code: "audience_unresolved",
      field: "audienceSource",
      value: row.own_or_ops ?? undefined,
      message: `No category for ${initiativeKey}, so its audience cannot be resolved.`,
    });
  }

  // Conversion paths
  const paths = derivePaths(row.cta_options, initiativeKey, warn);
  if (paths) config.allowedPaths = paths;

  // Format: the spec pins "Hybrid Events" to hybrid.
  if (normalizeKey(name) === HYBRID_EVENTS_KEY) config.formatOverride = "hybrid";

  // Partner block
  if (NETWORKING_WORD.test(name)) {
    config.partnerBlock = { host: true, booking: false };
    warn({
      code: "booking_name_matched",
      field: "partnerBlock",
      value: name,
      message: `Booking switched off for "${name}" because its name contains "networking". Confirm.`,
    });
  } else {
    config.partnerBlock = { ...DEFAULT_PARTNER_BLOCK };
  }

  // Type extras the spec names for this record (pitch day, webinar date, the
  // offer owner's cart dates, the dinner's guest list). Matched on the name;
  // left unset — not [] — for every other record, per rule 1 above.
  const extras = typeExtrasFor(name);
  if (extras) config.fieldExtras = extras;

  const derived = CONFIG_FIELDS.filter((f) => config[f] !== undefined);
  const needsHuman = CONFIG_FIELDS.filter(
    (f) => config[f] === undefined && (ALWAYS_HUMAN.has(f) || HUMAN_IF_UNSET.has(f))
  );
  return { config, derived, needsHuman, warnings };
}

/* ------------------------------------------------------------------ *
 * Batch
 * ------------------------------------------------------------------ */

export interface DeriveBatchResult {
  results: readonly DeriveResult[];
  /** For every field, how many records still need a human. Zero entries included. */
  needsHumanCounts: Readonly<Record<ConfigField, number>>;
  /** Every warning from every record, in input order. */
  warnings: readonly DeriveWarning[];
  /** Warning totals by code. Only codes that occurred. */
  warningCounts: Readonly<Partial<Record<DeriveWarningCode, number>>>;
}

export function deriveConfigs(rows: readonly LibraryRowInput[]): DeriveBatchResult {
  const results = rows.map(deriveConfig);
  const needsHumanCounts = Object.fromEntries(CONFIG_FIELDS.map((f) => [f, 0])) as Record<
    ConfigField,
    number
  >;
  const warnings: DeriveWarning[] = [];
  const warningCounts: Partial<Record<DeriveWarningCode, number>> = {};
  for (const r of results) {
    for (const f of r.needsHuman) needsHumanCounts[f] += 1;
    for (const w of r.warnings) {
      warnings.push(w);
      warningCounts[w.code] = (warningCounts[w.code] ?? 0) + 1;
    }
  }
  return { results, needsHumanCounts, warnings, warningCounts };
}
