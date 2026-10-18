import type { InitiativeKind } from "@/types";

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
  productId: string;
  name: string;
  description: string;
  kind: InitiativeKind;
  /** YYYY-MM-DD. */
  activationDate: string;
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

  const productId = typeof body.productId === "string" ? body.productId : "";
  if (!UUID_RE.test(productId)) {
    return { ok: false, error: "Add a product first — every initiative must be tied to a product." };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") return { ok: false, error: "Give the initiative a name." };
  if (name.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters.` };

  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return { ok: false, error: "Choose one-time, recurring or evergreen." };

  const activationDate = validDate(body.activationDate);
  if (!activationDate) return { ok: false, error: "Enter a valid activation date." };

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
    },
  };
}
