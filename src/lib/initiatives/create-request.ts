import type { InitiativeKind } from "@/types";
import {
  CONVERSION_PATHS,
  INITIATIVE_FORMATS,
  isCategoryId,
  type CategoryId,
  type ConversionPath,
  type InitiativeFormat,
} from "@/lib/intake-v3/library-config";

export type DatePrecision = "day" | "month";

/**
 * The body of POST /api/initiatives — creating one initiative from the in-app
 * Add Initiative panel.
 *
 * `libraryKey` null means the "Custom initiative" option. Company is NOT in the
 * body: the route takes it from the caller's profile, so a client cannot write
 * into another company.
 */
export interface CreateInitiativeRequest {
  libraryKey: string | null;
  annualPlanId: string;
  /** Null only on a new-form request (categoryId set): migration 045 relaxed the NOT NULL. */
  productId: string | null;
  name: string;
  description: string;
  kind: InitiativeKind;
  /** YYYY-MM-DD. Null only on a new-form request (categoryId set), as productId. */
  activationDate: string | null;
  /** YYYY-MM-DD, or null when not set. */
  eventDate: string | null;
  trafficInput: number | null;
  plannedBudget: number;
  revenueScenarios: { good: number; better: number; best: number };
  /**
   * What to track, for a library pick. The SERVER builds the metric set from
   * the library row; this only says which formats and optional metrics. Absent
   * means everything. Ignored for a custom initiative.
   */
  metricSelection?: {
    /** Labelled groups (formats) to keep. Absent means all. */
    groupLabels?: string[];
    /** Selection ids of optional metrics the customer unticked. */
    excludedOptional?: string[];
  };

  /*
   * Migration 045 columns, written by the new intake form. ALL OPTIONAL: a
   * key is set on the parsed value only when the body carried it, and the
   * route writes the column only then, so an old-form request is untouched.
   * `categoryId` (non-null) is what marks a request as new-form.
   */
  conversionPath?: ConversionPath | null;
  audienceSource?: "own" | "borrowed" | null;
  format?: InitiativeFormat | null;
  categoryId?: CategoryId | null;
  /** YYYY-MM-DD, or null. */
  revenueCloseDate?: string | null;
  activationDatePrecision?: DatePrecision;
  eventDatePrecision?: DatePrecision;
  /** The variable layers of the form. Always a plain object. */
  attrs?: Record<string, unknown>;
  /** Migration 061, recurring only: YYYY-MM-DD of the last occurrence. */
  lastOccurrenceDate?: string | null;
  /** Migration 061, recurring only: Good for ONE occurrence. */
  revenuePerOccurrence?: number | null;
  /** Migration 061: units x price target. Units are per occurrence when recurring. */
  unitsGoal?: number | null;
  unitPriceAtSet?: number | null;
  targetSource?: "suggested" | "edited" | null;
}

const AUDIENCE_SOURCES = ["own", "borrowed"] as const;
const DATE_PRECISIONS: readonly DatePrecision[] = ["day", "month"];

/** One of `allowed`, or null when the body sent null; "invalid" for anything else. */
function nullableEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null | "invalid" {
  if (v === null) return null;
  return allowed.find((a) => a === v) ?? "invalid";
}

/** A JSON-style plain object: not an array, not null, no exotic prototype. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

type NewFields = Pick<
  CreateInitiativeRequest,
  | "conversionPath"
  | "audienceSource"
  | "format"
  | "categoryId"
  | "revenueCloseDate"
  | "activationDatePrecision"
  | "eventDatePrecision"
  | "attrs"
  | "lastOccurrenceDate"
  | "revenuePerOccurrence"
  | "unitsGoal"
  | "unitPriceAtSet"
  | "targetSource"
>;

/** Validate the 045 fields. Each is checked only when its key is present. */
function parseNewFields(body: Record<string, unknown>): { ok: true; value: NewFields } | { ok: false; error: string } {
  const out: NewFields = {};

  if (body.conversionPath !== undefined) {
    const v = nullableEnum(body.conversionPath, CONVERSION_PATHS);
    if (v === "invalid") return { ok: false, error: "Invalid conversion path." };
    out.conversionPath = v;
  }
  if (body.audienceSource !== undefined) {
    const v = nullableEnum(body.audienceSource, AUDIENCE_SOURCES);
    if (v === "invalid") return { ok: false, error: "Invalid audience source." };
    out.audienceSource = v;
  }
  if (body.format !== undefined) {
    const v = nullableEnum(body.format, INITIATIVE_FORMATS);
    if (v === "invalid") return { ok: false, error: "Invalid format." };
    out.format = v;
  }
  if (body.categoryId !== undefined) {
    if (body.categoryId !== null && !isCategoryId(body.categoryId)) {
      return { ok: false, error: "Invalid category." };
    }
    out.categoryId = body.categoryId;
  }
  if (body.revenueCloseDate !== undefined) {
    if (body.revenueCloseDate === null) out.revenueCloseDate = null;
    else {
      const d = validDate(body.revenueCloseDate);
      if (!d) return { ok: false, error: "Enter a valid close date." };
      out.revenueCloseDate = d;
    }
  }
  // NOT NULL columns (default 'day'): null is not a value they can hold.
  if (body.activationDatePrecision !== undefined) {
    const v = DATE_PRECISIONS.find((p) => p === body.activationDatePrecision);
    if (!v) return { ok: false, error: "Invalid activation date precision." };
    out.activationDatePrecision = v;
  }
  if (body.eventDatePrecision !== undefined) {
    const v = DATE_PRECISIONS.find((p) => p === body.eventDatePrecision);
    if (!v) return { ok: false, error: "Invalid event date precision." };
    out.eventDatePrecision = v;
  }
  if (body.attrs !== undefined) {
    if (!isPlainObject(body.attrs)) return { ok: false, error: "Invalid attributes." };
    out.attrs = body.attrs;
  }
  if (body.lastOccurrenceDate !== undefined) {
    if (body.lastOccurrenceDate === null) out.lastOccurrenceDate = null;
    else {
      const d = validDate(body.lastOccurrenceDate);
      if (!d) return { ok: false, error: "Enter a valid last occurrence date." };
      out.lastOccurrenceDate = d;
    }
  }
  if (body.revenuePerOccurrence !== undefined) {
    const v = body.revenuePerOccurrence;
    if (v === null) out.revenuePerOccurrence = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0) out.revenuePerOccurrence = v;
    else return { ok: false, error: "Invalid revenue per occurrence." };
  }
  if (body.unitsGoal !== undefined) {
    const v = body.unitsGoal;
    if (v === null) out.unitsGoal = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000) out.unitsGoal = v;
    else return { ok: false, error: "Enter the units as a whole number." };
  }
  if (body.unitPriceAtSet !== undefined) {
    const v = body.unitPriceAtSet;
    if (v === null) out.unitPriceAtSet = null;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0) out.unitPriceAtSet = v;
    else return { ok: false, error: "Invalid unit price." };
  }
  if (body.targetSource !== undefined) {
    const v = body.targetSource;
    if (v === null || v === "suggested" || v === "edited") out.targetSource = v;
    else return { ok: false, error: "Invalid target source." };
  }

  return { ok: true, value: out };
}

const MAX_SELECTION = 200;

/** A list of strings, or undefined when absent; "invalid" for anything else. */
function stringList(v: unknown): string[] | undefined | "invalid" {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_SELECTION) return "invalid";
  if (!v.every((x): x is string => typeof x === "string" && x.length <= MAX_NAME)) return "invalid";
  return [...new Set(v)];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: readonly InitiativeKind[] = ["one-time", "recurring", "evergreen"];
const MAX_NAME = 200;

type Parsed = { ok: true; value: CreateInitiativeRequest } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite, non-negative amount; anything else reads as 0. */
function amount(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function validDate(v: unknown): string | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Validate an untrusted body. Pure. */
export function parseCreateInitiativeRequest(body: unknown): Parsed {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body." };

  const rawKey = body.libraryKey;
  let libraryKey: string | null = null;
  if (typeof rawKey === "string" && rawKey.trim() !== "") libraryKey = rawKey.trim();
  else if (rawKey !== null && rawKey !== undefined && rawKey !== "") {
    return { ok: false, error: "Invalid initiative." };
  }

  const annualPlanId = typeof body.annualPlanId === "string" ? body.annualPlanId : "";
  if (!UUID_RE.test(annualPlanId)) return { ok: false, error: "Generate your plan first." };

  const extra = parseNewFields(body);
  if (!extra.ok) return extra;
  // A request carrying a category is from the new form, which may leave the
  // product and activation date unset (migration 045). Otherwise: today's rules.
  const newForm = typeof extra.value.categoryId === "string";

  let productId: string | null = null;
  if (!(newForm && (body.productId === null || body.productId === undefined))) {
    productId = typeof body.productId === "string" ? body.productId : "";
    if (!UUID_RE.test(productId)) {
      return { ok: false, error: "Add a product first — every initiative must be tied to a product." };
    }
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") return { ok: false, error: "Give the initiative a name." };
  if (name.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters.` };

  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return { ok: false, error: "Choose one-time, recurring or evergreen." };

  let activationDate: string | null = null;
  if (!(newForm && (body.activationDate === null || body.activationDate === undefined))) {
    activationDate = validDate(body.activationDate);
    if (!activationDate) return { ok: false, error: "Enter a valid activation date." };
  }

  let eventDate: string | null = null;
  if (body.eventDate !== null && body.eventDate !== undefined && body.eventDate !== "") {
    eventDate = validDate(body.eventDate);
    if (!eventDate) return { ok: false, error: "Enter a valid event date." };
  }

  const traffic = amount(body.trafficInput);
  const scenarios = isRecord(body.revenueScenarios) ? body.revenueScenarios : {};

  // Shape only here; the route checks the entries against the library row.
  let metricSelection: CreateInitiativeRequest["metricSelection"];
  if (body.metricSelection !== undefined && body.metricSelection !== null) {
    if (!isRecord(body.metricSelection)) return { ok: false, error: "Invalid metric selection." };
    const groupLabels = stringList(body.metricSelection.groupLabels);
    const excludedOptional = stringList(body.metricSelection.excludedOptional);
    if (groupLabels === "invalid" || excludedOptional === "invalid") {
      return { ok: false, error: "Invalid metric selection." };
    }
    metricSelection = {
      ...(groupLabels ? { groupLabels } : {}),
      ...(excludedOptional ? { excludedOptional } : {}),
    };
  }

  return {
    ok: true,
    value: {
      libraryKey,
      annualPlanId,
      productId,
      name,
      description: typeof body.description === "string" ? body.description : "",
      kind,
      activationDate,
      eventDate,
      trafficInput: traffic > 0 ? Math.round(traffic) : null,
      plannedBudget: amount(body.plannedBudget),
      revenueScenarios: {
        good: amount(scenarios.good),
        better: amount(scenarios.better),
        best: amount(scenarios.best),
      },
      ...(metricSelection ? { metricSelection } : {}),
      ...extra.value,
    },
  };
}
