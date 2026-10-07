/**
 * Save-and-resume: turn the draft into database rows and back (REQ-2.4).
 *
 * The serialising is PURE and lives here, separate from the route, because the
 * round trip is where answers get quietly lost. A null that comes back as 0, or
 * a "Not sure" that comes back as answered, changes what the generator plans
 * against — and it would only show up as a strange plan weeks later.
 *
 * THREE RULES.
 *
 * Null survives as null. `toNumberOrNull` decides this once; nothing here
 * second-guesses it. Audience figures carry their `_unknown` flag so an
 * admitted unknown stays distinguishable from an unanswered field (REQ-2.6).
 *
 * Partial drafts are legal. A user who abandons on screen 6 must still leave a
 * usable row, so every field is written as whatever it currently is — including
 * nothing. Nothing here requires a complete answer set.
 *
 * `resume_screen` is a SLUG. Path C has 9 screens and A and B have 10, so index
 * 5 is a different screen depending on the path; a user who changed their
 * screen-0 answer would resume somewhere they had never been.
 *
 * `company_id` is NOT handled here at all. It is stamped by the route from the
 * session, so there is no path through this module that could accept one from a
 * request body.
 */

import type { ScreenId, PlanPath } from "@/lib/intake/flow";
import { resolveResumeScreen } from "@/lib/intake/flow";
import { toNumberOrNull, toTextOrNull, type IntakeAnswers } from "@/lib/intake/validation";
import { AUDIENCE_FIELDS, INDUSTRY_OTHER } from "@/lib/intake/schema";

/** The intake version this module writes. Lets the generator read v2 answers. */
export const INTAKE_VERSION = 2;

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

/** A `planning_inputs` row, minus the ids the route owns. */
export type PlanningInputRow = Record<string, unknown>;

export interface ProductDraft {
  /** Present when editing an existing row; absent for a new card. */
  id?: string | null;
  name?: unknown;
  product_type?: unknown;
  price_level?: unknown;
  payment_type?: unknown;
  recurring_interval?: unknown;
  delivery_mode?: unknown;
  average_price?: unknown;
  units_in_period?: unknown;
}

export interface InitiativeDraft {
  id?: string | null;
  /** 'planned' (screen 5), 'worked' or 'failed' (screen 6). */
  source?: unknown;
  initiative_key?: unknown;
  initiative_label?: unknown;
  custom_label?: unknown;
  product_ids?: unknown;
  cadence?: unknown;
  repeat_frequency?: unknown;
  start_month?: unknown;
  exact_date?: unknown;
  has_run_before?: unknown;
  audience_reached?: unknown;
  funnel_stages?: unknown;
  average_price?: unknown;
  failure_reason?: unknown;
}

export interface IntakeDraft {
  answers: IntakeAnswers;
  products: readonly ProductDraft[];
  initiatives: readonly InitiativeDraft[];
  /** Where the user is. Stored so a return visit lands on the same screen. */
  resumeScreen: ScreenId;
}

/* ------------------------------------------------------------------ *
 * Column maps
 * ------------------------------------------------------------------ */

/**
 * Scalar answers, grouped by type so the coercion is applied uniformly.
 *
 * Listing them explicitly is the point: a draft object is loosely typed, and
 * writing it wholesale would let a stray client-supplied key reach the table.
 * Anything not named here is dropped.
 */
const TEXT_COLUMNS = [
  "intake_path",
  "industry",
  "industry_other",
  "business_description",
  "purchase_mode",
  "growth_stage",
  "sales_owner",
  "plan_owner",
  "what_worked_notes",
  "what_failed_notes",
  "sells_to",
  "problem_solved",
  "ideal_customer_description",
  "challenge_notes",
] as const;

const NUMBER_COLUMNS = [
  "prior_period_revenue",
  "weekly_hours",
  "horizon_months",
  "team_size",
  "monthly_marketing_budget",
  "revenue_goal",
] as const;

/**
 * Columns that are NOT NULL in the database, with the value to write instead
 * of null.
 *
 * `planning_inputs` predates this intake. `revenue_goal` has been
 * `NOT NULL DEFAULT 0` since migration 001, because the v1 questionnaire asked
 * for it on its FIRST screen — so a row never existed without one. The v2
 * intake asks on screen 4, which means screens 0 to 3 try to save a partial row
 * with no goal yet and Postgres rejects the whole insert.
 *
 * Writing 0 rather than relaxing the constraint: a dozen places already read
 * `revenue_goal` and assume a number, and making it nullable would push this
 * problem into all of them. The null-versus-zero distinction carries no
 * information here either — the field is REQUIRED on screen 4, so validation
 * blocks the screen while it is unset, and 0 is never mistaken for a real
 * answer the way a 0 email list would be.
 *
 * Kept as a map rather than a special case inside the loop so that adding
 * another NOT NULL column is one line, and so the test can assert the map
 * covers every NOT NULL column the serialiser touches.
 */
export const NOT_NULL_NUMBER_FALLBACKS: Record<string, number> = {
  revenue_goal: 0,
};

const ARRAY_COLUMNS = ["customer_industries", "borrowed_audiences", "challenges"] as const;

const DATE_COLUMNS = ["plan_start_month"] as const;

/* ------------------------------------------------------------------ *
 * Serialise
 * ------------------------------------------------------------------ */

/**
 * The `planning_inputs` payload for the current draft.
 *
 * Writes every known column on every save, including the ones that are still
 * empty. Omitting blanks would make "the user cleared this field" and "the user
 * has not reached this screen" indistinguishable, so a cleared answer would
 * never actually clear.
 */
export function serialiseAnswers(draft: IntakeDraft): PlanningInputRow {
  const { answers } = draft;
  const row: PlanningInputRow = {
    intake_version: INTAKE_VERSION,
    resume_screen: draft.resumeScreen,
  };

  for (const column of TEXT_COLUMNS) {
    row[column] = toTextOrNull(answers[column]);
  }

  for (const column of NUMBER_COLUMNS) {
    const value = toNumberOrNull(answers[column]);
    // A NOT NULL column cannot take the null, so it takes its fallback. Every
    // other column keeps null, which is what tells the generator to use
    // benchmarks rather than to plan against a zero.
    row[column] =
      value === null && column in NOT_NULL_NUMBER_FALLBACKS
        ? NOT_NULL_NUMBER_FALLBACKS[column]
        : value;
  }

  for (const column of ARRAY_COLUMNS) {
    row[column] = toStringArray(answers[column]);
  }

  for (const column of DATE_COLUMNS) {
    row[column] = toDateOrNull(answers[column]);
  }

  // "Other" free text is meaningless unless Other is actually selected. Cleared
  // here so switching away from Other does not leave a stale industry behind
  // that the generator might read.
  if (row.industry !== INDUSTRY_OTHER) {
    row.industry_other = null;
  }

  // Audience figures with their "Not sure" flags.
  for (const spec of AUDIENCE_FIELDS) {
    const unknown = answers[spec.unknownField] === true;
    row[spec.field] = unknown ? null : toNumberOrNull(answers[spec.field]);
    row[spec.unknownField] = unknown;
  }

  return row;
}

/** A product card as an `intake_products` row, minus the ids. */
export function serialiseProduct(product: ProductDraft, order: number): Record<string, unknown> {
  return {
    name: toTextOrNull(product.name) ?? "",
    product_type: toTextOrNull(product.product_type),
    price_level: toTextOrNull(product.price_level),
    payment_type: toTextOrNull(product.payment_type),
    // Only meaningful for a recurring product; cleared otherwise so a changed
    // pricing model does not leave a contradictory interval behind.
    recurring_interval:
      product.payment_type === "recurring" ? toTextOrNull(product.recurring_interval) : null,
    delivery_mode: toTextOrNull(product.delivery_mode),
    average_price: toNumberOrNull(product.average_price),
    units_in_period: toNumberOrNull(product.units_in_period),
    display_order: order,
  };
}

/**
 * Translate an initiative's product references into real `intake_products` ids.
 *
 * WHY THIS IS NEEDED. Screen 5's product chips are keyed by ARRAY INDEX,
 * because a product card has no id until the draft is saved and the user can
 * reach screen 5 before that has happened. But `intake_initiatives.product_ids`
 * is `UUID[]`, so storing an index produces:
 *
 *   invalid input syntax for type uuid: "0"
 *
 * — which rejects the whole save. The fix has to live on the SAVE path rather
 * than in the component, because the ids only exist once the products have been
 * written, which is after the component has handed over its answers.
 *
 * Anything that is already a UUID passes through untouched, so a restored draft
 * (where the chips hold real ids) round-trips without being re-resolved. An
 * index with no product behind it is DROPPED rather than stored as null: a
 * dangling reference would survive into the plan and attribute revenue to a
 * product that does not exist.
 */
export function resolveProductIds(
  references: readonly string[],
  /** Real ids in the same order as the product cards. */
  productIdsByOrder: readonly string[]
): string[] {
  const resolved: string[] = [];

  for (const reference of references) {
    if (UUID_PATTERN.test(reference)) {
      resolved.push(reference);
      continue;
    }

    // Matched strictly: `Number("1.5")` is 1.5, but `Number.isInteger` is
    // checked against the PARSED value, so "1.5" would otherwise resolve to
    // index 1 and silently attach the wrong product.
    if (!/^\d+$/.test(reference)) continue;

    const index = Number(reference);
    if (!Number.isSafeInteger(index)) continue;

    const id = productIdsByOrder[index];
    if (id) resolved.push(id);
  }

  // Deduplicated: an index and its resolved UUID could both be present after a
  // partial edit, and the same product twice would double-count its revenue.
  return [...new Set(resolved)];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An initiative card as an `intake_initiatives` row, minus the ids. */
export function serialiseInitiative(
  initiative: InitiativeDraft,
  order: number,
  /**
   * Real product ids by card order. Omitted when the caller has none yet, in
   * which case index references are dropped rather than written as invalid
   * UUIDs.
   */
  productIdsByOrder: readonly string[] = []
): Record<string, unknown> {
  const customLabel = toTextOrNull(initiative.custom_label);

  return {
    source: toTextOrNull(initiative.source) ?? "planned",
    initiative_key: toTextOrNull(initiative.initiative_key) ?? "",
    initiative_label: toTextOrNull(initiative.initiative_label),
    custom_label: customLabel,
    // REQ-8.1: naming something the library does not carry is a signal about
    // what the library is missing, so it is flagged rather than discarded.
    needs_review: customLabel !== null,
    product_ids: resolveProductIds(
      toStringArray(initiative.product_ids),
      productIdsByOrder
    ),
    cadence: toTextOrNull(initiative.cadence),
    // Frequency only applies to a repeating initiative.
    repeat_frequency:
      initiative.cadence === "repeat" ? toTextOrNull(initiative.repeat_frequency) : null,
    start_month: toDateOrNull(initiative.start_month),
    exact_date: toDateOrNull(initiative.exact_date),
    has_run_before: toBooleanOrNull(initiative.has_run_before),
    audience_reached: toNumberOrNull(initiative.audience_reached),
    funnel_stages: serialiseFunnelStages(initiative.funnel_stages),
    average_price: toNumberOrNull(initiative.average_price),
    failure_reason: toTextOrNull(initiative.failure_reason),
    display_order: order,
  };
}

/**
 * Normalise the funnel array for storage.
 *
 * Order is preserved because each percentage applies to the people left after
 * the previous step. A skipped stage is kept as an explicit null rather than
 * dropped, so the stored array always describes the full funnel the user was
 * shown — `forecastPerRun` then returns no forecast rather than a low one.
 */
export function serialiseFunnelStages(
  value: unknown
): { key: string; label: string; percent: number | null }[] {
  if (!Array.isArray(value)) return [];

  const out: { key: string; label: string; percent: number | null }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { key, label, percent } = entry as {
      key?: unknown;
      label?: unknown;
      percent?: unknown;
    };
    if (typeof key !== "string" || key === "") continue;
    out.push({
      key,
      // The label is stored as asked, so a later rewording does not
      // retroactively change what a historic answer was answering.
      label: typeof label === "string" ? label : "",
      percent: toNumberOrNull(percent),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Restore
 * ------------------------------------------------------------------ */

/** What the API returns and the shell hydrates from. */
export interface RestoredDraft {
  answers: IntakeAnswers;
  products: ProductDraft[];
  initiatives: InitiativeDraft[];
  resumeScreen: ScreenId;
  path: PlanPath | null;
  /** False when there is no saved row yet, so the shell starts clean. */
  found: boolean;
}

/**
 * Rebuild the draft from stored rows.
 *
 * The inverse of `serialiseAnswers`, field for field, so a round trip is
 * lossless. Tested as a round trip for exactly that reason — checking the two
 * directions separately would miss a column present in one map and absent from
 * the other.
 */
export function restoreDraft(
  input: Record<string, unknown> | null,
  productRows: readonly Record<string, unknown>[] = [],
  initiativeRows: readonly Record<string, unknown>[] = []
): RestoredDraft {
  if (!input) {
    return {
      answers: {},
      products: [],
      initiatives: [],
      resumeScreen: "start",
      path: null,
      found: false,
    };
  }

  const answers: IntakeAnswers = {};

  for (const column of TEXT_COLUMNS) {
    answers[column] = input[column] ?? null;
  }
  for (const column of NUMBER_COLUMNS) {
    const value = toNumberOrNull(input[column]);
    /**
     * A NOT NULL column's fallback reads back as UNANSWERED, not as the
     * fallback.
     *
     * Otherwise someone resuming at screen 2 finds "0" sitting in the revenue
     * goal field — an answer they never gave, which they then have to clear
     * before they can type their own. Safe because the fallback is only ever
     * written while the field is genuinely unset: `revenue_goal` is required
     * and validated above zero, so a real 0 can never reach the database.
     */
    answers[column] =
      value !== null &&
      column in NOT_NULL_NUMBER_FALLBACKS &&
      value === NOT_NULL_NUMBER_FALLBACKS[column]
        ? null
        : value;
  }
  for (const column of ARRAY_COLUMNS) {
    answers[column] = toStringArray(input[column]);
  }
  for (const column of DATE_COLUMNS) {
    answers[column] = toDateOrNull(input[column]);
  }

  for (const spec of AUDIENCE_FIELDS) {
    const unknown = input[spec.unknownField] === true;
    answers[spec.field] = unknown ? null : toNumberOrNull(input[spec.field]);
    answers[spec.unknownField] = unknown;
  }

  const path = toPath(input.intake_path);

  return {
    answers,
    products: productRows.map(restoreProduct),
    initiatives: initiativeRows.map(restoreInitiative),
    /**
     * An off-path or unknown slug falls back to the start rather than
     * stranding the user: someone who changed their screen-0 answer may have a
     * stored screen their new path does not contain.
     */
    resumeScreen: resolveResumeScreen(path, asString(input.resume_screen)),
    path,
    found: true,
  };
}

function restoreProduct(row: Record<string, unknown>): ProductDraft {
  return {
    id: asString(row.id),
    name: row.name ?? null,
    product_type: row.product_type ?? null,
    price_level: row.price_level ?? null,
    payment_type: row.payment_type ?? null,
    recurring_interval: row.recurring_interval ?? null,
    delivery_mode: row.delivery_mode ?? null,
    average_price: toNumberOrNull(row.average_price),
    units_in_period: toNumberOrNull(row.units_in_period),
  };
}

function restoreInitiative(row: Record<string, unknown>): InitiativeDraft {
  return {
    id: asString(row.id),
    source: row.source ?? "planned",
    initiative_key: row.initiative_key ?? null,
    initiative_label: row.initiative_label ?? null,
    custom_label: row.custom_label ?? null,
    product_ids: toStringArray(row.product_ids),
    cadence: row.cadence ?? null,
    repeat_frequency: row.repeat_frequency ?? null,
    start_month: toDateOrNull(row.start_month),
    exact_date: toDateOrNull(row.exact_date),
    has_run_before: toBooleanOrNull(row.has_run_before),
    audience_reached: toNumberOrNull(row.audience_reached),
    funnel_stages: serialiseFunnelStages(row.funnel_stages),
    average_price: toNumberOrNull(row.average_price),
    failure_reason: row.failure_reason ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Lifecycle (REQ-14.3)
 * ------------------------------------------------------------------ */

export type OnboardingStatus =
  | "signed_up"
  | "intake_started"
  | "intake_complete"
  | "plan_viewed"
  | "first_actuals_entered";

/** Each status and the column that timestamps it. */
const STATUS_TIMESTAMPS: Record<OnboardingStatus, string> = {
  signed_up: "signed_up_at",
  intake_started: "intake_started_at",
  intake_complete: "intake_complete_at",
  plan_viewed: "plan_viewed_at",
  first_actuals_entered: "first_actuals_at",
};

/** Forward order, so the funnel cannot be measured backwards. */
const STATUS_ORDER: OnboardingStatus[] = [
  "signed_up",
  "intake_started",
  "intake_complete",
  "plan_viewed",
  "first_actuals_entered",
];

/**
 * The status columns to write when a user reaches a state.
 *
 * MONOTONIC: a later state never regresses to an earlier one. Someone who has
 * built a plan and comes back to edit an answer is still past
 * `intake_complete`, and letting the status slip backwards would show them as
 * dropping out of a funnel they already finished.
 *
 * The timestamp is written only the FIRST time, so "when did they finish the
 * intake" stays the original answer rather than the most recent edit.
 */
export function statusUpdate(
  current: string | null | undefined,
  reached: OnboardingStatus,
  existingTimestamp: string | null | undefined,
  now: string = new Date().toISOString()
): Record<string, unknown> {
  const currentIndex = STATUS_ORDER.indexOf((current ?? "") as OnboardingStatus);
  const reachedIndex = STATUS_ORDER.indexOf(reached);

  const update: Record<string, unknown> = {};

  if (reachedIndex > currentIndex) {
    update.onboarding_status = reached;
  }

  if (!existingTimestamp) {
    update[STATUS_TIMESTAMPS[reached]] = now;
  }

  return update;
}

export function timestampColumnFor(status: OnboardingStatus): string {
  return STATUS_TIMESTAMPS[status];
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

/**
 * Normalise to a `YYYY-MM-DD` string for a DATE column.
 *
 * Date-only strings are kept as given rather than round-tripped through
 * `new Date()`, which interprets them as UTC midnight and then formats them in
 * local time — enough to shift a plan's start into the previous month.
 */
function toDateOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return null;
  // A month picker sends YYYY-MM; the column needs a day, and the 1st is what
  // "this month" means for a plan start.
  return `${match[1]}-${match[2]}-${match[3] ?? "01"}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function toPath(value: unknown): PlanPath | null {
  return value === "know_most" || value === "know_some" || value === "recommend_all"
    ? value
    : null;
}
