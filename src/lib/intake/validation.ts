/**
 * Per-screen validation for the intake. Pure, so it runs identically in the
 * form and on the server.
 *
 * TWO RULES SHAPE EVERYTHING HERE.
 *
 * Only REQUIRED fields block (REQ-2.5). The intake is a planning aid, and a
 * user who cannot leave screen 8 because they do not know their website
 * traffic never reaches a plan at all. So the default is "accept it", and the
 * blocking set is the explicit list in `schema.ts`.
 *
 * An absent answer is never a zero (REQ-2.6). "Not sure" and a skipped field
 * both reach the generator as null, which tells it to use benchmarks. A 0 tells
 * it the business genuinely has no audience and plans accordingly — a wrong
 * plan that looks right. `toNumberOrNull` is the single place that decision is
 * made, so no screen can get it wrong locally.
 *
 * Validation returns a field-keyed map rather than a boolean: the form marks
 * individual inputs, and a single "something is wrong" flag would leave the
 * user hunting.
 */

import type { ScreenId } from "@/lib/intake/flow";
import {
  REQUIRED_FIELDS,
  REQUIRED_PRODUCT_FIELDS,
  REQUIRED_INITIATIVE_FIELDS,
  MIN_PRODUCTS,
  MIN_PLANNED_INITIATIVES,
  MAX_OBSTACLES,
  CADENCE_REPEAT,
  PRICING_MODEL_RECURRING,
  INDUSTRY_OTHER,
  SOMETHING_ELSE_KEY,
  isPlanningPeriod,
} from "@/lib/intake/schema";

/* ------------------------------------------------------------------ *
 * Result shape
 * ------------------------------------------------------------------ */

/** Field name -> message. Empty means the screen may advance. */
export type FieldErrors = Record<string, string>;

export interface ValidationResult {
  valid: boolean;
  /** Scalar fields on this screen. */
  errors: FieldErrors;
  /** Per-row errors for the repeating sections, indexed as they render. */
  rowErrors: Record<number, FieldErrors>;
  /** Errors about the collection itself, e.g. "add at least one product". */
  formError: string | null;
}

function ok(): ValidationResult {
  return { valid: true, errors: {}, rowErrors: {}, formError: null };
}

function result(
  errors: FieldErrors,
  rowErrors: Record<number, FieldErrors> = {},
  formError: string | null = null
): ValidationResult {
  const valid =
    Object.keys(errors).length === 0 &&
    Object.keys(rowErrors).length === 0 &&
    formError === null;
  return { valid, errors, rowErrors, formError };
}

/* ------------------------------------------------------------------ *
 * Coercion — the null-versus-zero boundary
 * ------------------------------------------------------------------ */

/**
 * Parse a number input, preserving the difference between empty and zero.
 *
 * Returns null for "", null, undefined and anything unparseable. Returns 0 only
 * when the user actually typed a zero. This is the function REQ-2.6 rests on:
 * a `Number("") === 0` anywhere in a screen component would turn "I skipped
 * this" into "I have none".
 *
 * Commas are stripped because `NumberInput` renders them as the user types.
 */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/[,$\s]/g, "");
  if (cleaned === "") return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The value to store for an audience number, honouring "Not sure".
 *
 * Ticking "Not sure" discards whatever was typed: the user has overridden
 * themselves, and keeping a half-typed figure alongside the unknown flag would
 * leave two contradictory answers in the row.
 */
export function audienceValue(
  raw: unknown,
  notSure: boolean
): { value: number | null; unknown: boolean } {
  if (notSure) return { value: null, unknown: true };
  return { value: toNumberOrNull(raw), unknown: false };
}

/** Trim to null, so an all-whitespace answer is not treated as given. */
export function toTextOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/* ------------------------------------------------------------------ *
 * Primitive checks
 * ------------------------------------------------------------------ */

/** Is this answer present at all? Zero and false count as answers. */
export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;

/**
 * Percent bounds (REQ-2.1).
 *
 * Null passes: every funnel percentage is optional, and a blank one produces no
 * forecast rather than a wrong one.
 */
export function percentError(value: unknown): string | null {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  if (n < PERCENT_MIN || n > PERCENT_MAX) return "Enter a number between 0 and 100.";
  return null;
}

/** Money cannot be negative. Zero is allowed — $0 budget is a real answer. */
export function moneyError(value: unknown, label = "amount"): string | null {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  if (n < 0) return `Enter a ${label} of 0 or more.`;
  return null;
}

function countError(value: unknown, min: number, label: string): string | null {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  if (!Number.isInteger(n)) return `Enter a whole number of ${label}.`;
  if (n < min) return `Enter at least ${min}.`;
  return null;
}

/* ------------------------------------------------------------------ *
 * Answers shape
 * ------------------------------------------------------------------ */

/**
 * The draft, keyed by the column it is stored in.
 *
 * Loose on purpose: the screens are still being built, and a strict interface
 * here would have to be edited in lockstep with every one of them. The required
 * map and the per-field checks below are what actually constrain it.
 */
export type IntakeAnswers = Record<string, unknown>;

export interface ProductRow {
  name?: unknown;
  product_type?: unknown;
  price_level?: unknown;
  payment_type?: unknown;
  recurring_interval?: unknown;
  delivery_mode?: unknown;
  average_price?: unknown;
  units_in_period?: unknown;
}

export interface InitiativeRow {
  initiative_key?: unknown;
  custom_label?: unknown;
  product_ids?: unknown;
  cadence?: unknown;
  repeat_frequency?: unknown;
  audience_reached?: unknown;
  average_price?: unknown;
  funnel_stages?: unknown;
}

/* ------------------------------------------------------------------ *
 * Required-field sweep
 * ------------------------------------------------------------------ */

/** Human wording for the blocking message, by field. */
const REQUIRED_MESSAGES: Record<string, string> = {
  intake_path: "Pick one to continue.",
  industry: "Choose your industry.",
  prior_period_revenue: "Enter your revenue for the last 12 months.",
  growth_stage: "Pick the stage that fits best.",
  team_size: "Enter how many people work in the business.",
  monthly_marketing_budget: "Enter your monthly budget. 0 is fine.",
  horizon_months: "Choose how far ahead to plan.",
  plan_start_month: "Choose when the plan starts.",
  revenue_goal: "Enter your revenue goal.",
  sells_to: "Choose who you sell to.",
  ideal_customer: "Tell us who you serve.",
  problem_solved: "Tell us what problem you solve.",
};

const DEFAULT_REQUIRED_MESSAGE = "This one's needed to continue.";

function requiredErrors(screen: ScreenId, answers: IntakeAnswers): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of REQUIRED_FIELDS[screen]) {
    if (!isAnswered(answers[field])) {
      errors[field] = REQUIRED_MESSAGES[field] ?? DEFAULT_REQUIRED_MESSAGE;
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Per-screen validators
 * ------------------------------------------------------------------ */

function validateBusiness(answers: IntakeAnswers): ValidationResult {
  const errors = requiredErrors("business", answers);

  // "Other" is only a real answer once they say what it is — otherwise the
  // generator has no industry to filter the library on at all.
  if (answers.industry === INDUSTRY_OTHER && !isAnswered(answers.industry_other)) {
    errors.industry_other = "Tell us your industry.";
  }

  const revenue = moneyError(answers.prior_period_revenue, "revenue");
  if (revenue && !errors.prior_period_revenue) {
    errors.prior_period_revenue = revenue;
  }

  return result(errors);
}

function validateTeam(answers: IntakeAnswers): ValidationResult {
  const errors = requiredErrors("team", answers);

  // Minimum 1 (REQ-5.1): the owner counts, so a business of 0 people is not a
  // skipped answer but a wrong one.
  const team = countError(answers.team_size, 1, "people");
  if (team && !errors.team_size) errors.team_size = team;

  const hours = toNumberOrNull(answers.weekly_hours);
  if (hours !== null && (hours < 0 || hours > 168)) {
    errors.weekly_hours = "Enter between 0 and 168 hours.";
  }

  // $0 is explicitly allowed; negative is not.
  const budget = moneyError(answers.monthly_marketing_budget, "budget");
  if (budget && !errors.monthly_marketing_budget) {
    errors.monthly_marketing_budget = budget;
  }

  return result(errors);
}

/**
 * Screen 3. Validates the period selectors plus every product card.
 *
 * `plan_start_month` must not be in the past (REQ-6.2) — a plan that starts
 * last month would have the generator sequencing tasks into dates that have
 * already gone by.
 */
export function validateProducts(
  answers: IntakeAnswers,
  products: readonly ProductRow[],
  today: Date = new Date()
): ValidationResult {
  const errors = requiredErrors("products", answers);

  if (isAnswered(answers.horizon_months) && !isPlanningPeriod(answers.horizon_months)) {
    errors.horizon_months = "Choose 3, 6, 12 or 18 months.";
  }

  const startMonth = monthStart(answers.plan_start_month);
  if (startMonth && startMonth < monthStartOf(today)) {
    errors.plan_start_month = "Pick this month or later.";
  }

  const rowErrors: Record<number, FieldErrors> = {};
  products.forEach((product, index) => {
    const row = validateProductRow(product);
    if (Object.keys(row).length > 0) rowErrors[index] = row;
  });

  const formError =
    products.length < MIN_PRODUCTS ? "Add at least one product to continue." : null;

  return result(errors, rowErrors, formError);
}

function validateProductRow(product: ProductRow): FieldErrors {
  const errors: FieldErrors = {};

  for (const field of REQUIRED_PRODUCT_FIELDS) {
    if (!isAnswered(product[field])) {
      errors[field] = REQUIRED_PRODUCT_MESSAGES[field];
    }
  }

  // A price of 0 passes the "answered" check but makes the product's goal 0,
  // which would quietly understate the whole plan.
  const price = toNumberOrNull(product.average_price);
  if (price !== null && price <= 0 && !errors.average_price) {
    errors.average_price = "Enter the average price customers pay.";
  }

  const units = toNumberOrNull(product.units_in_period);
  if (units !== null && !errors.units_in_period) {
    if (!Number.isInteger(units)) errors.units_in_period = "Enter a whole number.";
    else if (units <= 0) errors.units_in_period = "Enter how many you want to sell.";
  }

  // REQ-6.6: Recurring reveals the interval, so leaving it blank means the
  // revealed field was ignored rather than not asked.
  if (product.payment_type === PRICING_MODEL_RECURRING && !isAnswered(product.recurring_interval)) {
    errors.recurring_interval = "Choose per month or per year.";
  }

  return errors;
}

const REQUIRED_PRODUCT_MESSAGES: Record<(typeof REQUIRED_PRODUCT_FIELDS)[number], string> = {
  name: "Give this product a name.",
  average_price: "Enter the average price customers pay.",
  units_in_period: "Enter how many you want to sell.",
};

/**
 * Screen 4. The goal is required and bounded only by being positive.
 *
 * Deliberately NOT checked against the products total or the prior period
 * (REQ-7.1, REQ-7.4): the stretch warning is advisory and must never block. A
 * user who means to triple their revenue is allowed to say so.
 */
function validateGoal(answers: IntakeAnswers): ValidationResult {
  const errors = requiredErrors("goal", answers);

  const goal = toNumberOrNull(answers.revenue_goal);
  if (goal !== null && goal <= 0 && !errors.revenue_goal) {
    errors.revenue_goal = "Enter a revenue goal above 0.";
  }

  return result(errors);
}

/**
 * Screen 5, Paths A and B only. Minimum one initiative (REQ-8.1).
 *
 * Path C never reaches this screen, so there is no "skip" case to handle here —
 * `flow.ts` omits it from the sequence entirely.
 */
export function validateInitiatives(
  initiatives: readonly InitiativeRow[]
): ValidationResult {
  const rowErrors: Record<number, FieldErrors> = {};

  initiatives.forEach((initiative, index) => {
    const row = validateInitiativeRow(initiative);
    if (Object.keys(row).length > 0) rowErrors[index] = row;
  });

  const formError =
    initiatives.length < MIN_PLANNED_INITIATIVES
      ? "Add at least one initiative, or go back and ask us to recommend them."
      : null;

  return result({}, rowErrors, formError);
}

function validateInitiativeRow(initiative: InitiativeRow): FieldErrors {
  const errors: FieldErrors = {};

  for (const field of REQUIRED_INITIATIVE_FIELDS) {
    if (!isAnswered(initiative[field])) {
      errors[field] = REQUIRED_INITIATIVE_MESSAGES[field];
    }
  }

  // "Something else" is a placeholder until they name it, and it is what sets
  // `needs_review` so the library gap gets looked at.
  if (initiative.initiative_key === SOMETHING_ELSE_KEY && !isAnswered(initiative.custom_label)) {
    errors.custom_label = "Tell us what it is.";
  }

  // REQ-8.6: "On repeat" reveals the frequency.
  if (initiative.cadence === CADENCE_REPEAT && !isAnswered(initiative.repeat_frequency)) {
    errors.repeat_frequency = "How often does it repeat?";
  }

  // Funnel fields are ALL optional (REQ-8.10); only out-of-range values are
  // rejected. A blank stage yields no forecast, which is handled in funnel.ts.
  Object.assign(errors, funnelErrors(initiative));

  return errors;
}

const REQUIRED_INITIATIVE_MESSAGES: Record<
  (typeof REQUIRED_INITIATIVE_FIELDS)[number],
  string
> = {
  initiative_key: "Choose what this initiative is.",
  product_ids: "Pick at least one product it sells.",
};

/**
 * Range checks on the five funnel inputs. Never requires any of them.
 *
 * Keyed `funnel.<stage>` so a screen can surface the error on the right input
 * without the stage keys leaking into the top-level error map.
 */
export function funnelErrors(initiative: InitiativeRow): FieldErrors {
  const errors: FieldErrors = {};

  const audience = toNumberOrNull(initiative.audience_reached);
  if (audience !== null && audience < 0) {
    errors.audience_reached = "Enter 0 or more.";
  }

  const price = moneyError(initiative.average_price, "price");
  if (price) errors.average_price = price;

  const stages = Array.isArray(initiative.funnel_stages) ? initiative.funnel_stages : [];
  for (const stage of stages) {
    if (!stage || typeof stage !== "object") continue;
    const { key, percent } = stage as { key?: unknown; percent?: unknown };
    if (typeof key !== "string") continue;
    const error = percentError(percent);
    if (error) errors[`funnel.${key}`] = error;
  }

  return errors;
}

/**
 * Screen 6. Nothing is required — a business with no history is a legitimate
 * answer, and Path C users may have none at all.
 */
function validateWins(answers: IntakeAnswers): ValidationResult {
  const worked = asArray(answers.worked_initiatives);
  const didntWork = asArray(answers.didnt_work);

  const errors: FieldErrors = {};

  // The same initiative cannot both have driven sales and have failed. Caught
  // here because it reaches the generator as contradictory guidance: REQ-13.8
  // would exclude it while the wins list recommends it.
  const overlap = worked.filter((key) => didntWork.includes(key));
  if (overlap.length > 0) {
    errors.didnt_work = "Something can't be both a win and a flop. Pick one.";
  }

  return result(errors);
}

function validateCustomer(answers: IntakeAnswers): ValidationResult {
  // REQ-10.2's industries field is NOT required even when revealed: a user
  // selling to businesses across the board has no single answer to give.
  return result(requiredErrors("customer", answers));
}

/**
 * Screen 8. Every number is optional and every one may be "Not sure".
 *
 * The only failure is a negative figure — an audience cannot be below zero, and
 * accepting one would feed a nonsense number into the forecast.
 */
function validateAudience(answers: IntakeAnswers): ValidationResult {
  const errors: FieldErrors = {};

  for (const spec of AUDIENCE_NUMBER_FIELDS) {
    const value = toNumberOrNull(answers[spec]);
    if (value !== null && value < 0) errors[spec] = "Enter 0 or more.";
  }

  return result(errors);
}

const AUDIENCE_NUMBER_FIELDS = [
  "email_list_size",
  "social_following",
  "monthly_visitors",
  "past_customers",
  "monthly_leads",
] as const;

/** Screen 9. The only hard rule is the cap of 3 (REQ-12.1). */
function validateObstacles(answers: IntakeAnswers): ValidationResult {
  const errors: FieldErrors = {};
  const chosen = asArray(answers.challenges);

  if (chosen.length > MAX_OBSTACLES) {
    errors.challenges = `Pick up to ${MAX_OBSTACLES}.`;
  }

  return result(errors);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface ValidateArgs {
  screen: ScreenId;
  answers: IntakeAnswers;
  products?: readonly ProductRow[];
  initiatives?: readonly InitiativeRow[];
  /** Injectable so the start-month check is testable. */
  today?: Date;
}

/**
 * Validate one screen.
 *
 * Screens with nothing to check return valid rather than throwing, so adding a
 * screen cannot accidentally make the flow unadvanceable.
 */
export function validateScreen(args: ValidateArgs): ValidationResult {
  const { screen, answers } = args;

  switch (screen) {
    case "start":
      return result(requiredErrors("start", answers));
    case "business":
      return validateBusiness(answers);
    case "team":
      return validateTeam(answers);
    case "products":
      return validateProducts(answers, args.products ?? [], args.today);
    case "goal":
      return validateGoal(answers);
    case "initiatives":
      return validateInitiatives(args.initiatives ?? []);
    case "wins":
      return validateWins(answers);
    case "customer":
      return validateCustomer(answers);
    case "audience":
      return validateAudience(answers);
    case "obstacles":
      return validateObstacles(answers);
    default:
      return ok();
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** First of the month for a stored `YYYY-MM-DD` or Date, or null. */
function monthStart(value: unknown): Date | null {
  if (value instanceof Date) return monthStartOf(value);
  if (typeof value !== "string" || value.trim() === "") return null;
  // Parsed as UTC parts rather than `new Date(string)`, which shifts a
  // date-only string by the local offset and can land in the previous month.
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

function monthStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
