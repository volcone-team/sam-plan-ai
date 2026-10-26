/**
 * Reads and writes initiative_library_config (migration 045).
 *
 * THE ONLY MODULE THAT TOUCHES THAT TABLE. The admin routes call it. It never
 * restricts the initiative_settings.is_active toggle; see
 * `isOfferedInIntakePicker` for how incomplete configs are kept from customers.
 *
 * SERVICE-ROLE CLIENT ONLY. 045 gives the table RLS with a SELECT-only policy,
 * so a user-session client can read but every write here would fail.
 *
 * NEVER THROWS. Every exported async function returns a discriminated result;
 * a throwing client becomes `{ ok: false, error }`.
 *
 * `is_launch` IS NEVER READ OR WRITTEN. It is superseded by
 * initiative_settings.is_active (missing row = active). The column keeps its
 * DEFAULT FALSE on insert and means nothing.
 *
 * NULL vs UNSET vs []. The three allowed_* arrays, category_id and
 * audience_source are NULL for "not configured yet". A NULL never becomes `[]`
 * here; it becomes an absent field, and the effective config falls back to
 * deriveConfig for it. The optional fields (format_override, ongoing_label)
 * are different: "none" is a valid configured state, so once a row exists its
 * NULL is authoritative and the derived value does NOT come back. Otherwise an
 * admin could never clear the derived "hybrid" override.
 *
 * revenue_lines / field_extras / partner_* are NOT NULL with defaults in 045,
 * so a saved row always carries them: the database cannot say "revenue lines
 * not configured yet" once a row exists.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  categoryById,
  isCategoryId,
  validateLibraryConfig,
  CONVERSION_PATHS,
  FIELD_EXTRA_BINDS,
  FIELD_EXTRA_DERIVES,
  FIELD_EXTRA_TYPES,
  INITIATIVE_FORMATS,
  INITIATIVE_KINDS,
  MAX_FIELD_EXTRAS,
  NAMED_DATES,
  PRICE_SOURCES,
  RECURRENCE_FREQUENCIES,
  type CanonicalCategory,
  type CategoryId,
  type ConfigProblem,
  type ConversionPath,
  type FieldExtra,
  type FieldExtraBind,
  type FieldExtraDerive,
  type FieldExtraType,
  type InitiativeFormat,
  type InitiativeKind,
  type LibraryRecordConfig,
  type PartnerBlockConfig,
  type RecordAudienceSource,
  type RecurrenceFrequency,
  type RevenueLine,
} from "./library-config";
import {
  CONFIG_FIELDS,
  WORKBOOK_FLAG_FIELDS,
  deriveConfig,
  type ConfigField,
  type DeriveWarning,
  type DerivedConfig,
} from "./derive-config";
import { isMissingColumnError } from "../supabase/missing-column";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export const CONFIG_TABLE = "initiative_library_config";

/** An initiative_library_config row, minus is_launch. */
export interface ConfigRow {
  initiative_key: string;
  category_id: string | null;
  allowed_kinds: string[] | null;
  allowed_paths: string[] | null;
  allowed_frequencies: string[] | null;
  audience_source: string | null;
  format_override: string | null;
  ongoing_label: string | null;
  partner_host: boolean;
  partner_booking: boolean;
  revenue_lines: unknown;
  field_extras: unknown;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** Columns read. is_launch deliberately absent. */
const CONFIG_COLUMNS =
  "initiative_key, category_id, allowed_kinds, allowed_paths, allowed_frequencies, " +
  "audience_source, format_override, ongoing_label, partner_host, partner_booking, " +
  "revenue_lines, field_extras, updated_at, updated_by";

const LIBRARY_COLUMNS_BASE = "initiative_key, workbook_id, name, category, own_or_ops, cta_options";

/** The raw workbook Frequency / Allowed Frequencies cells. Exist only once 051 is applied. */
const LIBRARY_COLUMNS_051 = "allowed_kinds_raw, allowed_frequencies_raw";

/** The raw workbook Start Date / Event Date cells. Exist only once 054 is applied. */
const LIBRARY_COLUMNS_054 = "start_date_raw, event_date_raw";

const LIBRARY_COLUMNS_PRE_054 = `${LIBRARY_COLUMNS_BASE}, ${LIBRARY_COLUMNS_051}`;

const LIBRARY_COLUMNS = `${LIBRARY_COLUMNS_PRE_054}, ${LIBRARY_COLUMNS_054}`;

/**
 * The column lists to try, newest migration dropped first: everything, then
 * without 054, then without 051 too. Same order as ingest's
 * nextLibraryColumnSet.
 */
export const LIBRARY_COLUMN_FALLBACKS: readonly string[] = Object.freeze([
  LIBRARY_COLUMNS,
  LIBRARY_COLUMNS_PRE_054,
  LIBRARY_COLUMNS_BASE,
]);

type SelectResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };

let warned054 = false;
let warned051 = false;

function warnFallback(dropped: string): void {
  if (dropped === LIBRARY_COLUMNS_054 && !warned054) {
    warned054 = true;
    console.warn(
      "[intake-v3/config-repo] migration 054 columns missing on wb_initiative_library; " +
      "every record asks for both dates until it is applied."
    );
  } else if (dropped === LIBRARY_COLUMNS_051 && !warned051) {
    warned051 = true;
    console.warn(
      "[intake-v3/config-repo] migration 051 columns missing on wb_initiative_library; " +
      "kinds and frequencies are not derived from the workbook until it is applied."
    );
  }
}

/**
 * Run a wb_initiative_library select with the 051 and 054 columns, and again
 * with fewer (054 dropped first, then 051) while the database refuses a
 * missing column. Migrations are applied by hand, so the admin page and the
 * intake picker must keep working before either: the record then simply
 * derives no kinds / frequencies, or no date flags (the raw cells read as
 * blank, and a blank date flag means "ask"). Any other error is returned as is.
 */
function selectLibrary(run: (columns: string) => PromiseLike<SelectResult>): Promise<SelectResult> {
  // NOT async: the first `run` must throw synchronously, as the bare query
  // did, so a throwing client inside Promise.all is caught by the caller's
  // try/catch instead of becoming an unhandled rejection.
  const first = run(LIBRARY_COLUMN_FALLBACKS[0]);
  const retry = (res: SelectResult, step: number): PromiseLike<SelectResult> | SelectResult => {
    if (!res.error || !isMissingColumnError(res.error)) return res;
    if (step + 1 >= LIBRARY_COLUMN_FALLBACKS.length) return res;
    warnFallback(step === 0 ? LIBRARY_COLUMNS_054 : LIBRARY_COLUMNS_051);
    return Promise.resolve(run(LIBRARY_COLUMN_FALLBACKS[step + 1])).then((next) => retry(next, step + 1));
  };
  return Promise.resolve(first).then((res) => retry(res, 0));
}

/** The config as stored, camelCase. Same shape as DerivedConfig: every field optional. */
export type StoredConfig = DerivedConfig;

/** Where a field of the effective config came from. */
export type FieldSource = "saved" | "derived" | "unset";

/** Contract fields that must be present before validateLibraryConfig can run. */
export const REQUIRED_FIELDS: readonly ConfigField[] = Object.freeze([
  "categoryId",
  "audienceSource",
  "allowedKinds",
  "allowedPaths",
  "allowedFrequencies",
  "revenueLines",
  "fieldExtras",
]);

/** Optional fields: once a row exists, its value (including none) is authoritative. */
const ROW_AUTHORITATIVE: ReadonlySet<ConfigField> = new Set<ConfigField>([
  "formatOverride",
  "ongoingLabel",
  "partnerBlock",
  "revenueLines",
  "fieldExtras",
]);

export type ConfigStatus =
  | { status: "valid" }
  | { status: "invalid"; problems: readonly ConfigProblem[] }
  | { status: "incomplete"; missing: readonly ConfigField[] };

export interface LibraryConfigRecord {
  initiativeKey: string;
  library: {
    workbookId: string | null;
    name: string | null;
    category: string | null;
    ownOrOps: string | null;
    ctaOptions: string[];
  };
  /** The saved row, mapped. Null when no row exists. */
  saved: StoredConfig | null;
  savedMeta: { updatedAt: string | null; updatedBy: string | null } | null;
  settings: { exists: boolean; isActive: boolean; maxPerPlan: number | null };
  effective: StoredConfig;
  sources: Readonly<Record<ConfigField, FieldSource>>;
  category: CanonicalCategory | null;
  categorySource: FieldSource;
  validation: ConfigStatus;
  /** Fields a human still has to decide (deriver's list, minus anything saved). */
  needsHuman: readonly ConfigField[];
  warnings: readonly DeriveWarning[];
}

export interface LibraryConfigSummary {
  total: number;
  withSavedRow: number;
  complete: number;
  valid: number;
  invalid: number;
  incomplete: number;
  active: number;
  /** Records passing isOfferedInIntakePicker: active and valid. */
  offeredInPicker: number;
  needsHumanCounts: Readonly<Record<ConfigField, number>>;
}

export interface Reconciliation {
  /** Config rows whose key is not in the current library. Harmless; reported. */
  orphanConfigKeys: string[];
  /** Library records with no config row yet. Seeding creates these. */
  missingConfigKeys: string[];
}

export type LoadResult =
  | {
      ok: true;
      records: LibraryConfigRecord[];
      summary: LibraryConfigSummary;
      reconciliation: Reconciliation;
    }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Pure mappers
 * ------------------------------------------------------------------ */

const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

const jsonArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * DB row → camelCase config. NULL columns stay ABSENT, never `[]`.
 * category_id is carried as `categoryId` beside the contract fields.
 */
export function rowToConfig(row: ConfigRow): StoredConfig {
  const config: StoredConfig = { initiativeKey: row.initiative_key };
  if (isCategoryId(row.category_id)) config.categoryId = row.category_id;

  const kinds = strArray(row.allowed_kinds);
  if (kinds) config.allowedKinds = kinds as InitiativeKind[];
  const paths = strArray(row.allowed_paths);
  if (paths) config.allowedPaths = paths as ConversionPath[];
  const freqs = strArray(row.allowed_frequencies);
  if (freqs) config.allowedFrequencies = freqs as RecurrenceFrequency[];

  if (row.audience_source === "own" || row.audience_source === "borrowed") {
    config.audienceSource = row.audience_source;
  }
  if (row.format_override != null) config.formatOverride = row.format_override as InitiativeFormat;
  if (row.ongoing_label != null) config.ongoingLabel = row.ongoing_label;

  config.partnerBlock = {
    host: row.partner_host !== false,
    booking: row.partner_booking !== false,
  };
  config.revenueLines = jsonArray<RevenueLine>(row.revenue_lines);
  config.fieldExtras = jsonArray<FieldExtra>(row.field_extras);
  return config;
}

/**
 * camelCase config → DB row. Absent fields become NULL (arrays included —
 * never `[]`), except the NOT NULL columns, which take their 045 defaults.
 * Every key is always present, so a bulk insert has one uniform column list.
 */
export function configToRow(config: StoredConfig): ConfigRow {
  return {
    initiative_key: config.initiativeKey,
    category_id: config.categoryId ?? null,
    allowed_kinds: config.allowedKinds ? [...config.allowedKinds] : null,
    allowed_paths: config.allowedPaths ? [...config.allowedPaths] : null,
    allowed_frequencies: config.allowedFrequencies ? [...config.allowedFrequencies] : null,
    audience_source: config.audienceSource ?? null,
    format_override: config.formatOverride ?? null,
    ongoing_label: config.ongoingLabel ?? null,
    partner_host: config.partnerBlock?.host ?? true,
    partner_booking: config.partnerBlock?.booking ?? true,
    revenue_lines: config.revenueLines ? [...config.revenueLines] : [],
    field_extras: config.fieldExtras ? [...config.fieldExtras] : [],
  };
}

/* ------------------------------------------------------------------ *
 * Pure: effective config and status
 * ------------------------------------------------------------------ */

const hasField = (c: StoredConfig | null, f: ConfigField): boolean =>
  !!c && (c as Record<string, unknown>)[f] !== undefined;

/**
 * Saved wins over derived, field by field.
 *
 * For the "not configured yet" fields an absent saved value falls back to
 * derived. For ROW_AUTHORITATIVE fields, an existing row decides even when it
 * says "none".
 */
export function mergeEffective(
  initiativeKey: string,
  saved: StoredConfig | null,
  derived: StoredConfig
): { effective: StoredConfig; sources: Record<ConfigField, FieldSource> } {
  const effective: Record<string, unknown> = { initiativeKey };
  const sources = {} as Record<ConfigField, FieldSource>;
  for (const f of CONFIG_FIELDS) {
    if (hasField(saved, f)) {
      effective[f] = (saved as Record<string, unknown>)[f];
      sources[f] = "saved";
    } else if (saved && ROW_AUTHORITATIVE.has(f)) {
      sources[f] = "saved";
    } else if (hasField(derived, f)) {
      effective[f] = (derived as Record<string, unknown>)[f];
      sources[f] = "derived";
    } else {
      sources[f] = "unset";
    }
  }
  // The workbook-only date flags: ALWAYS the derived value, saved row or not.
  // There is no column to save them in, so a saved config never carries them.
  for (const f of WORKBOOK_FLAG_FIELDS) {
    const v = derived[f];
    if (typeof v === "boolean") effective[f] = v;
  }
  return { effective: effective as StoredConfig, sources };
}

/**
 * Incomplete (a required field is unset) is distinct from invalid (complete,
 * and validateLibraryConfig refuses it). Only complete configs are validated.
 */
export function configStatus(config: StoredConfig): ConfigStatus {
  const missing = REQUIRED_FIELDS.filter((f) => !hasField(config, f));
  const category = categoryById(config.categoryId);
  if (!category && !missing.includes("categoryId")) missing.unshift("categoryId");
  if (missing.length > 0 || !category) return { status: "incomplete", missing };

  const result = validateLibraryConfig(toRecordConfig(config)!, category);
  return result.ok ? { status: "valid" } : { status: "invalid", problems: result.problems };
}

/**
 * A complete stored config as the contract's LibraryRecordConfig, or null if
 * a required field is unset. Does NOT validate; pair with configStatus. The
 * resolved category is not part of the contract and is not carried.
 */
export function toRecordConfig(config: StoredConfig): LibraryRecordConfig | null {
  if (REQUIRED_FIELDS.some((f) => !hasField(config, f))) return null;
  return {
    initiativeKey: config.initiativeKey,
    // Superseded by initiative_settings.is_active; the validator never reads it.
    isLaunch: false,
    allowedKinds: config.allowedKinds!,
    allowedPaths: config.allowedPaths!,
    audienceSource: config.audienceSource!,
    allowedFrequencies: config.allowedFrequencies!,
    revenueLines: config.revenueLines!,
    fieldExtras: config.fieldExtras!,
    ...(config.ongoingLabel !== undefined ? { ongoingLabel: config.ongoingLabel } : {}),
    ...(config.formatOverride !== undefined ? { formatOverride: config.formatOverride } : {}),
    ...(config.partnerBlock !== undefined ? { partnerBlock: config.partnerBlock } : {}),
    // Workbook-only; unset means "ask" (see resolveFormLayout).
    ...(typeof config.askStartDate === "boolean" ? { askStartDate: config.askStartDate } : {}),
    ...(typeof config.askEventDate === "boolean" ? { askEventDate: config.askEventDate } : {}),
  };
}

/** Library records vs config rows. Pure. */
export function reconcile(
  libraryKeys: readonly string[],
  configKeys: readonly string[]
): Reconciliation {
  const lib = new Set(libraryKeys);
  const cfg = new Set(configKeys);
  return {
    orphanConfigKeys: configKeys.filter((k) => !lib.has(k)),
    missingConfigKeys: libraryKeys.filter((k) => !cfg.has(k)),
  };
}

/* ------------------------------------------------------------------ *
 * Pure: patch parsing and merging
 * ------------------------------------------------------------------ */

/** What an admin may send. `null` clears a field. `isLaunch` is not accepted. */
export interface ConfigPatch {
  categoryId?: CategoryId | null;
  audienceSource?: RecordAudienceSource | null;
  allowedKinds?: InitiativeKind[] | null;
  allowedPaths?: ConversionPath[] | null;
  allowedFrequencies?: RecurrenceFrequency[] | null;
  formatOverride?: InitiativeFormat | null;
  ongoingLabel?: string | null;
  partnerBlock?: PartnerBlockConfig | null;
  revenueLines?: RevenueLine[] | null;
  fieldExtras?: FieldExtra[] | null;
}

export type PatchParse = { ok: true; patch: ConfigPatch } | { ok: false; errors: string[] };

const PATCH_KEYS = new Set<string>(CONFIG_FIELDS);

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function vocabArray<T extends string>(
  key: string,
  v: unknown,
  vocab: readonly T[],
  errors: string[]
): T[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    errors.push(`${key} must be an array of strings or null.`);
    return undefined;
  }
  const bad = v.filter((x) => !vocab.includes(x as T));
  if (bad.length) errors.push(`${key}: ${bad.join(", ")} not one of ${vocab.join(", ")}.`);
  if (new Set(v).size !== v.length) errors.push(`${key} contains duplicates.`);
  return v as T[];
}

/**
 * Shape and vocabulary check of an untrusted patch. Coherence rules (leads on
 * own audience, etc.) are NOT checked here — that is validateLibraryConfig's
 * job, on the merged config. This only stops what the 045 CHECKs would reject
 * with an opaque database error.
 */
export function parseConfigPatch(raw: unknown): PatchParse {
  if (!isObj(raw)) return { ok: false, errors: ["patch must be an object."] };
  const errors: string[] = [];
  const patch: ConfigPatch = {};
  const keys = Object.keys(raw);
  if (keys.length === 0) return { ok: false, errors: ["patch is empty."] };

  for (const key of keys) {
    if (!PATCH_KEYS.has(key)) {
      errors.push(
        key === "isLaunch"
          ? "isLaunch is not configurable here; use initiative_settings.is_active."
          : `Unknown field "${key}".`
      );
    }
  }

  if ("categoryId" in raw) {
    const v = raw.categoryId;
    if (v === null || isCategoryId(v)) patch.categoryId = v;
    else errors.push(`categoryId "${String(v)}" is not a known category.`);
  }
  if ("audienceSource" in raw) {
    const v = raw.audienceSource;
    if (v === null || v === "own" || v === "borrowed") patch.audienceSource = v;
    else errors.push("audienceSource must be own, borrowed or null.");
  }
  if ("allowedKinds" in raw) {
    const v = vocabArray("allowedKinds", raw.allowedKinds, INITIATIVE_KINDS, errors);
    if (v !== undefined) patch.allowedKinds = v;
  }
  if ("allowedPaths" in raw) {
    const v = vocabArray("allowedPaths", raw.allowedPaths, CONVERSION_PATHS, errors);
    if (v !== undefined) patch.allowedPaths = v;
  }
  if ("allowedFrequencies" in raw) {
    const v = vocabArray("allowedFrequencies", raw.allowedFrequencies, RECURRENCE_FREQUENCIES, errors);
    if (v !== undefined) patch.allowedFrequencies = v;
  }
  if ("formatOverride" in raw) {
    const v = raw.formatOverride;
    if (v === null || INITIATIVE_FORMATS.includes(v as InitiativeFormat)) {
      patch.formatOverride = v as InitiativeFormat | null;
    } else errors.push(`formatOverride must be one of ${INITIATIVE_FORMATS.join(", ")} or null.`);
  }
  if ("ongoingLabel" in raw) {
    const v = raw.ongoingLabel;
    if (v === null) patch.ongoingLabel = null;
    else if (nonEmptyStr(v) && v.length <= 60) patch.ongoingLabel = v.trim();
    else errors.push("ongoingLabel must be a non-empty string of at most 60 characters, or null.");
  }
  if ("partnerBlock" in raw) {
    const v = raw.partnerBlock;
    if (v === null) patch.partnerBlock = null;
    else if (isObj(v) && typeof v.host === "boolean" && typeof v.booking === "boolean") {
      patch.partnerBlock = { host: v.host, booking: v.booking };
    } else errors.push("partnerBlock must be { host: boolean, booking: boolean } or null.");
  }
  if ("revenueLines" in raw) {
    const v = raw.revenueLines;
    if (v === null) patch.revenueLines = null;
    else if (!Array.isArray(v)) errors.push("revenueLines must be an array or null.");
    else {
      const lines: RevenueLine[] = [];
      v.forEach((l, i) => {
        if (
          !isObj(l) ||
          !nonEmptyStr(l.id) ||
          !PRICE_SOURCES.includes(l.priceSource as never) ||
          !NAMED_DATES.includes(l.windowOpens as never) ||
          !NAMED_DATES.includes(l.windowCloses as never) ||
          (l.condition !== undefined && typeof l.condition !== "string")
        ) {
          errors.push(`revenueLines[${i}] is not a valid revenue line.`);
          return;
        }
        lines.push({
          id: l.id.trim(),
          priceSource: l.priceSource as RevenueLine["priceSource"],
          windowOpens: l.windowOpens as RevenueLine["windowOpens"],
          windowCloses: l.windowCloses as RevenueLine["windowCloses"],
          ...(typeof l.condition === "string" ? { condition: l.condition } : {}),
        });
      });
      patch.revenueLines = lines;
    }
  }
  if ("fieldExtras" in raw) {
    const v = raw.fieldExtras;
    if (v === null) patch.fieldExtras = null;
    else if (!Array.isArray(v)) errors.push("fieldExtras must be an array or null.");
    else {
      const extras: FieldExtra[] = [];
      v.forEach((e, i) => {
        if (!isObj(e) || !nonEmptyStr(e.key) || !nonEmptyStr(e.label) || !nonEmptyStr(e.readBy)) {
          errors.push(`fieldExtras[${i}] needs non-empty key, label and readBy.`);
          return;
        }
        if (e.type !== undefined && !FIELD_EXTRA_TYPES.includes(e.type as FieldExtraType)) {
          errors.push(`fieldExtras[${i}].type must be one of ${FIELD_EXTRA_TYPES.join(", ")}.`);
          return;
        }
        if (e.binds !== undefined && !FIELD_EXTRA_BINDS.includes(e.binds as FieldExtraBind)) {
          errors.push(`fieldExtras[${i}].binds must be one of ${FIELD_EXTRA_BINDS.join(", ")}.`);
          return;
        }
        if (e.derives !== undefined && !FIELD_EXTRA_DERIVES.includes(e.derives as FieldExtraDerive)) {
          errors.push(`fieldExtras[${i}].derives must be one of ${FIELD_EXTRA_DERIVES.join(", ")}.`);
          return;
        }
        if (e.hint !== undefined && typeof e.hint !== "string") {
          errors.push(`fieldExtras[${i}].hint must be a string.`);
          return;
        }
        const hint = typeof e.hint === "string" ? e.hint.trim() : "";
        extras.push({
          key: e.key.trim(),
          label: e.label.trim(),
          readBy: e.readBy.trim(),
          ...(e.type !== undefined ? { type: e.type as FieldExtraType } : {}),
          ...(hint ? { hint } : {}),
          ...(e.binds !== undefined ? { binds: e.binds as FieldExtraBind } : {}),
          ...(e.derives !== undefined ? { derives: e.derives as FieldExtraDerive } : {}),
        });
      });
      patch.fieldExtras = extras;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, patch };
}

/**
 * What `null` means for the columns 045 makes NOT NULL: their default, so the
 * in-memory config matches what reading the row back would give.
 */
const NULL_MEANS_DEFAULT: Partial<Record<ConfigField, () => unknown>> = {
  revenueLines: () => [],
  fieldExtras: () => [],
  partnerBlock: () => ({ host: true, booking: true }),
};

/** Patch over a stored config. `null` clears the field; absent keeps it. */
export function applyPatch(base: StoredConfig, patch: ConfigPatch): StoredConfig {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value !== null) out[key] = value;
    else {
      const fallback = NULL_MEANS_DEFAULT[key as ConfigField];
      if (fallback) out[key] = fallback();
      else delete out[key];
    }
  }
  return out as StoredConfig;
}

/* ------------------------------------------------------------------ *
 * Pure: is a record offered in the new intake picker?
 * ------------------------------------------------------------------ */

/** The minimal shape the picker predicate reads. LibraryConfigRecord fits it. */
export interface PickerCandidate {
  /** initiative_settings.is_active; a missing settings row = active. */
  settings: { isActive: boolean };
  validation: ConfigStatus;
}

/**
 * Whether a record is offered in the new intake picker: active AND its
 * effective intake config is valid.
 *
 * THE ADMIN TOGGLE IS NEVER RESTRICTED. initiative_settings.is_active can be
 * switched on or off on /admin/ai-workbook regardless of intake config; it
 * keeps controlling what the AI uses exactly as before. Instead, the picker
 * filters here: a record whose config is incomplete or invalid is simply not
 * offered, so a half-configured record still cannot reach a customer.
 */
export function isOfferedInIntakePicker(record: PickerCandidate): boolean {
  return record.settings.isActive && record.validation.status === "valid";
}

/**
 * The effective LibraryRecordConfig for each key in `offeredKeys`, for the
 * intake form. Only keys the picker actually returns get a config, so nothing
 * about an unoffered record is sent; a key whose config is not complete is
 * left out (an offered record is always valid, so this does not happen).
 */
export function pickerConfigs(
  records: readonly Pick<LibraryConfigRecord, "initiativeKey" | "effective">[],
  offeredKeys: readonly string[]
): Record<string, LibraryRecordConfig> {
  const wanted = new Set(offeredKeys);
  const out: Record<string, LibraryRecordConfig> = {};
  for (const r of records) {
    if (!wanted.has(r.initiativeKey)) continue;
    const config = toRecordConfig(r.effective);
    if (config) out[r.initiativeKey] = config;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Database
 * ------------------------------------------------------------------ */

interface LibraryRow {
  initiative_key: string;
  workbook_id: string | null;
  name: string | null;
  category: string | null;
  own_or_ops: string | null;
  cta_options: string[] | null;
  /** Migration 051; absent when the select fell back to the pre-051 columns. */
  allowed_kinds_raw?: string | null;
  allowed_frequencies_raw?: string | null;
  /** Migration 054; absent when the select fell back to the pre-054 columns. */
  start_date_raw?: string | null;
  event_date_raw?: string | null;
}

interface SettingsRow {
  initiative_key: string;
  is_active: boolean | null;
  max_per_plan: number | null;
}

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : isObj(e) && typeof e.message === "string" ? e.message : String(e);

function deriveFor(row: LibraryRow) {
  return deriveConfig({
    initiative_key: row.initiative_key,
    name: row.name,
    category: row.category,
    own_or_ops: row.own_or_ops,
    cta_options: row.cta_options,
    allowed_kinds_raw: row.allowed_kinds_raw ?? null,
    allowed_frequencies_raw: row.allowed_frequencies_raw ?? null,
    start_date_raw: row.start_date_raw ?? null,
    event_date_raw: row.event_date_raw ?? null,
  });
}

/** One library record, assembled. Pure; exported for tests. */
export function buildRecord(
  lib: LibraryRow,
  savedRow: ConfigRow | undefined,
  settingsRow: SettingsRow | undefined
): LibraryConfigRecord {
  const derivation = deriveFor(lib);
  const saved = savedRow ? rowToConfig(savedRow) : null;
  const { effective, sources } = mergeEffective(lib.initiative_key, saved, derivation.config);
  return {
    initiativeKey: lib.initiative_key,
    library: {
      workbookId: lib.workbook_id ?? null,
      name: lib.name ?? null,
      category: lib.category ?? null,
      ownOrOps: lib.own_or_ops ?? null,
      ctaOptions: strArray(lib.cta_options) ?? [],
    },
    saved,
    savedMeta: savedRow
      ? { updatedAt: savedRow.updated_at ?? null, updatedBy: savedRow.updated_by ?? null }
      : null,
    settings: {
      exists: !!settingsRow,
      isActive: settingsRow?.is_active !== false,
      maxPerPlan: settingsRow?.max_per_plan ?? null,
    },
    effective,
    sources,
    category: categoryById(effective.categoryId) ?? null,
    categorySource: sources.categoryId,
    validation: configStatus(effective),
    needsHuman: derivation.needsHuman.filter((f) => sources[f] !== "saved"),
    warnings: derivation.warnings,
  };
}

export async function loadLibraryConfigs(db: SupabaseClient): Promise<LoadResult> {
  try {
    const [lib, cfg, set] = await Promise.all([
      selectLibrary((cols) =>
        db.from("wb_initiative_library").select(cols).order("display_order", { ascending: true })
      ),
      db.from(CONFIG_TABLE).select(CONFIG_COLUMNS),
      db.from("initiative_settings").select("initiative_key, is_active, max_per_plan"),
    ]);
    if (lib.error) return { ok: false, error: `wb_initiative_library: ${errText(lib.error)}` };
    if (cfg.error) return { ok: false, error: `${CONFIG_TABLE}: ${errText(cfg.error)}` };
    if (set.error) return { ok: false, error: `initiative_settings: ${errText(set.error)}` };

    const libraryRows = (lib.data ?? []) as unknown as LibraryRow[];
    const configRows = (cfg.data ?? []) as unknown as ConfigRow[];
    const configs = new Map(configRows.map((r) => [r.initiative_key, r]));
    const settings = new Map(
      ((set.data ?? []) as unknown as SettingsRow[]).map((r) => [r.initiative_key, r])
    );

    const records = libraryRows.map((r) =>
      buildRecord(r, configs.get(r.initiative_key), settings.get(r.initiative_key))
    );

    const needsHumanCounts = Object.fromEntries(CONFIG_FIELDS.map((f) => [f, 0])) as Record<
      ConfigField,
      number
    >;
    for (const r of records) for (const f of r.needsHuman) needsHumanCounts[f] += 1;
    const count = (s: ConfigStatus["status"]) => records.filter((r) => r.validation.status === s).length;
    const valid = count("valid");
    const invalid = count("invalid");

    return {
      ok: true,
      records,
      summary: {
        total: records.length,
        withSavedRow: records.filter((r) => r.saved).length,
        complete: valid + invalid,
        valid,
        invalid,
        incomplete: count("incomplete"),
        active: records.filter((r) => r.settings.isActive).length,
        offeredInPicker: records.filter(isOfferedInIntakePicker).length,
        needsHumanCounts,
      },
      reconciliation: reconcile(
        libraryRows.map((r) => r.initiative_key),
        configRows.map((r) => r.initiative_key)
      ),
    };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

export type SaveResult =
  | {
      ok: true;
      initiativeKey: string;
      /** True when this save created the row. */
      created: boolean;
      saved: StoredConfig;
      effective: StoredConfig;
      sources: Readonly<Record<ConfigField, FieldSource>>;
      validation: ConfigStatus;
    }
  | { ok: false; reason: "bad_request"; errors: string[] }
  | { ok: false; reason: "not_found"; message: string }
  | { ok: false; reason: "invalid"; problems: readonly ConfigProblem[] }
  | { ok: false; reason: "db_error"; message: string };

/**
 * Merge a patch over the saved row (or, with no row yet, over the row seeding
 * would have written) and upsert it.
 *
 * AN INCOMPLETE SAVE IS ALLOWED — 87 records get filled in over several
 * sittings. A COMPLETE BUT INVALID one is refused. Validation runs on the
 * EFFECTIVE config (saved over derived), the same thing load and the
 * picker predicate judge, so they cannot disagree.
 */
export async function saveLibraryConfig(
  db: SupabaseClient,
  initiativeKey: unknown,
  rawPatch: unknown,
  adminUserId: string
): Promise<SaveResult> {
  if (!nonEmptyStr(initiativeKey)) {
    return { ok: false, reason: "bad_request", errors: ["initiativeKey must be a non-empty string."] };
  }
  const key = initiativeKey.trim();
  const parsed = parseConfigPatch(rawPatch);
  if (!parsed.ok) return { ok: false, reason: "bad_request", errors: parsed.errors };

  try {
    const [lib, cfg] = await Promise.all([
      selectLibrary((cols) =>
        db.from("wb_initiative_library").select(cols).eq("initiative_key", key).maybeSingle()
      ),
      db.from(CONFIG_TABLE).select(CONFIG_COLUMNS).eq("initiative_key", key).maybeSingle(),
    ]);
    if (lib.error) return { ok: false, reason: "db_error", message: errText(lib.error) };
    if (cfg.error) return { ok: false, reason: "db_error", message: errText(cfg.error) };
    if (!lib.data) {
      // The editor works from the library. Writing a row for an absent key
      // would create an orphan on purpose.
      return { ok: false, reason: "not_found", message: `${key} is not in the initiative library.` };
    }

    const derived = deriveFor(lib.data as unknown as LibraryRow).config;
    const savedRow = cfg.data as unknown as ConfigRow | null;
    const base = savedRow ? rowToConfig(savedRow) : rowToConfig(configToRow(derived));
    const merged = applyPatch(base, parsed.patch);
    const { effective, sources } = mergeEffective(key, merged, derived);
    const validation = configStatus(effective);

    if (validation.status === "invalid") {
      return { ok: false, reason: "invalid", problems: validation.problems };
    }
    // An incomplete config skips the validator, but 045 refuses a fourth
    // extra regardless; say so in the contract's words rather than as a
    // CHECK violation.
    if ((merged.fieldExtras?.length ?? 0) > MAX_FIELD_EXTRAS) {
      return {
        ok: false,
        reason: "invalid",
        problems: [
          {
            code: "too_many_extras",
            field: "fieldExtras",
            message: `At most ${MAX_FIELD_EXTRAS} extra fields.`,
          },
        ],
      };
    }

    const { error } = await db.from(CONFIG_TABLE).upsert(
      {
        ...configToRow(merged),
        updated_at: new Date().toISOString(),
        updated_by: adminUserId,
      },
      { onConflict: "initiative_key" }
    );
    if (error) return { ok: false, reason: "db_error", message: errText(error) };

    return { ok: true, initiativeKey: key, created: !savedRow, saved: merged, effective, sources, validation };
  } catch (err) {
    return { ok: false, reason: "db_error", message: errText(err) };
  }
}

export type SeedResult =
  | { ok: true; created: number; skipped: number; createdKeys: string[] }
  | { ok: false; error: string };

/**
 * Insert a derived row for every library record that has none.
 *
 * NEVER OVERWRITES. The write is INSERT ... ON CONFLICT (initiative_key) DO
 * NOTHING (upsert with ignoreDuplicates), so an existing row is untouched even
 * if an admin saved it between our read and our write — a select-then-insert
 * alone would have that window. The preceding read only trims the payload to
 * the missing keys; correctness does not depend on it. `created` is what the
 * database RETURNED, which under DO NOTHING is only the rows actually
 * inserted, so a lost race is counted as skipped, not created.
 *
 * Idempotent: a second run finds nothing missing and writes nothing.
 */
export async function seedLibraryConfigs(
  db: SupabaseClient,
  adminUserId: string
): Promise<SeedResult> {
  try {
    const [lib, cfg] = await Promise.all([
      selectLibrary((cols) => db.from("wb_initiative_library").select(cols)),
      db.from(CONFIG_TABLE).select("initiative_key"),
    ]);
    if (lib.error) return { ok: false, error: `wb_initiative_library: ${errText(lib.error)}` };
    if (cfg.error) return { ok: false, error: `${CONFIG_TABLE}: ${errText(cfg.error)}` };

    const libraryRows = (lib.data ?? []) as unknown as LibraryRow[];
    const existing = new Set(
      ((cfg.data ?? []) as unknown as { initiative_key: string }[]).map((r) => r.initiative_key)
    );
    const missing = libraryRows.filter((r) => !existing.has(r.initiative_key));
    if (missing.length === 0) {
      return { ok: true, created: 0, skipped: libraryRows.length, createdKeys: [] };
    }

    const now = new Date().toISOString();
    // Every row has the same keys, so the bulk insert's column list is
    // uniform and no NOT NULL column is sent as NULL.
    const rows = missing.map((r) => ({
      ...configToRow(deriveFor(r).config),
      updated_at: now,
      updated_by: adminUserId,
    }));
    const { data, error } = await db
      .from(CONFIG_TABLE)
      .upsert(rows, { onConflict: "initiative_key", ignoreDuplicates: true })
      .select("initiative_key");
    if (error) return { ok: false, error: errText(error) };

    const createdKeys = ((data ?? []) as { initiative_key: string }[]).map((r) => r.initiative_key);
    return {
      ok: true,
      created: createdKeys.length,
      skipped: libraryRows.length - createdKeys.length,
      createdKeys,
    };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}
