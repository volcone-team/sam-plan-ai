/**
 * Chat budget arithmetic.
 *
 * Budgets are POOLED PER COMPANY, not per user: several members share one
 * subscription, so a 5-seat company must not get 5x the allowance of a 1-seat
 * one. Every assistant turn's input + output tokens count against the same pool
 * (both are billed).
 *
 * Pure functions only — the route owns the queries. Kept separate because this
 * decides whether a paid API call happens, which is worth testing directly.
 */

/** Platform default when a company has no chat_budgets override. */
export const DEFAULT_DAILY_TOKEN_CAP = 200_000;

/**
 * Tokens that must remain before a new turn is allowed.
 *
 * A request is refused when the remaining pool could not plausibly cover the
 * reply, rather than at zero. Without this, a company sitting just under the cap
 * would start a paid call that gets cut off mid-sentence — billed, and useless.
 * Sized for a grounded prompt (workbook context) plus a short answer.
 */
export const MIN_HEADROOM_TOKENS = 6_000;

export interface BudgetState {
  /** input + output tokens already spent by this company today. */
  usedToday: number;
  /** Effective cap: the company override, else the platform default. */
  dailyCap: number;
}

export interface BudgetDecision {
  allowed: boolean;
  usedToday: number;
  dailyCap: number;
  remaining: number;
  /** True when the cap is 0 — chat is switched off for this company entirely. */
  disabled: boolean;
}

/**
 * Decide whether a company may send another chat message.
 *
 * A cap of 0 means "no chat for this company", which is distinct from having
 * spent the day's allowance — the UI wording differs, so it is reported
 * separately rather than inferred from remaining === 0.
 */
export function evaluateBudget(state: BudgetState): BudgetDecision {
  const dailyCap = sanitizeCap(state.dailyCap);
  const usedToday = Math.max(0, sanitizeNumber(state.usedToday));
  const remaining = Math.max(0, dailyCap - usedToday);

  if (dailyCap === 0) {
    return { allowed: false, usedToday, dailyCap, remaining: 0, disabled: true };
  }

  return {
    allowed: remaining >= MIN_HEADROOM_TOKENS,
    usedToday,
    dailyCap,
    remaining,
    disabled: false,
  };
}

/** Sum the token spend of assistant rows. Malformed values count as 0. */
export function sumTokens(
  rows: readonly { tokens_input: number | null; tokens_output: number | null }[]
): number {
  let total = 0;
  for (const row of rows) {
    total += Math.max(0, sanitizeNumber(row.tokens_input));
    total += Math.max(0, sanitizeNumber(row.tokens_output));
  }
  return total;
}

/**
 * Start of the current UTC day, for the "today" window.
 *
 * UTC rather than a company's local timezone: the reset must be deterministic
 * and identical for every reader (route, dashboard, report). A local-midnight
 * reset would need per-company timezone data and would make two companies'
 * numbers incomparable.
 */
export function startOfUtcDayISO(now: number = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/** Resolve the effective cap: company override if present, else the default. */
export function effectiveCap(
  override: number | null | undefined,
  platformDefault: number | null | undefined
): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (
    typeof platformDefault === "number" &&
    Number.isFinite(platformDefault) &&
    platformDefault >= 0
  ) {
    return Math.floor(platformDefault);
  }
  return DEFAULT_DAILY_TOKEN_CAP;
}

function sanitizeNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

function sanitizeCap(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_DAILY_TOKEN_CAP;
  }
  return Math.floor(value);
}
