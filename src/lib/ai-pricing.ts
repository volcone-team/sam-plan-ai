/**
 * Anthropic model pricing and cost estimation.
 *
 * IMPORTANT — THESE ARE ESTIMATES, NOT BILLED AMOUNTS.
 * Cost is computed from the token counts the API reports, multiplied by the
 * per-million rates below. It will track your invoice closely but will not match
 * it to the cent, because:
 *   - Prompt caching (cache writes/reads are priced differently) is not modelled.
 *   - Batch discounts are not modelled.
 *   - Rates here are a static snapshot and drift when Anthropic changes prices.
 * Treat the numbers as "what we spent, roughly" for trend and per-customer
 * comparison. Anthropic's own console remains the source of truth for billing.
 *
 * Keep RATES in sync with https://www.anthropic.com/pricing when models change.
 */

/** USD per million tokens. */
export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Known model rates, keyed by a prefix of the model id. Anthropic model ids
 * carry a date suffix (e.g. claude-sonnet-4-5-20250929), so lookup is by prefix
 * to avoid a table entry per dated release.
 */
export const RATES: Record<string, ModelRate> = {
  "claude-opus-4": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "claude-3-5-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-opus": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-3-haiku": { inputPerMillion: 0.25, outputPerMillion: 1.25 },
};

/**
 * Rate used when a model id matches nothing above — priced as Sonnet, the
 * mid-tier. Returning null instead would make unknown models look FREE in
 * reports, which is the more dangerous failure: spend would silently vanish.
 */
export const FALLBACK_RATE: ModelRate = { inputPerMillion: 3, outputPerMillion: 15 };

/** Longest matching prefix wins, so 'claude-3-5-sonnet' beats a shorter entry. */
export function rateForModel(model: string | null | undefined): ModelRate {
  if (!model) return FALLBACK_RATE;
  const id = model.toLowerCase();

  let best: { key: string; rate: ModelRate } | null = null;
  for (const [key, rate] of Object.entries(RATES)) {
    if (!id.startsWith(key)) continue;
    if (!best || key.length > best.key.length) best = { key, rate };
  }
  return best ? best.rate : FALLBACK_RATE;
}

/** True when the model id is priced from a real table entry, not the fallback. */
export function isKnownModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const id = model.toLowerCase();
  return Object.keys(RATES).some((key) => id.startsWith(key));
}

/**
 * Estimated USD cost of one call.
 *
 * Null/negative/non-finite token counts are treated as 0 rather than throwing:
 * this feeds dashboards, and one malformed row must not break a whole report.
 * Rounded to 6 decimals to match the NUMERIC(12,6) column — individual chat
 * turns can cost well under a cent.
 */
export function estimateCostUsd(
  model: string | null | undefined,
  tokensInput: number | null | undefined,
  tokensOutput: number | null | undefined
): number {
  const rate = rateForModel(model);
  const inTok = sanitizeTokens(tokensInput);
  const outTok = sanitizeTokens(tokensOutput);

  const cost =
    (inTok / 1_000_000) * rate.inputPerMillion +
    (outTok / 1_000_000) * rate.outputPerMillion;

  return Math.round(cost * 1_000_000) / 1_000_000;
}

function sanitizeTokens(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/** Format a USD amount for display. Sub-cent values keep 4 decimals. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  if (amount > 0 && amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

/**
 * Models a super admin may select for the chatbot.
 *
 * An ALLOWLIST, not a free-text field: the stored value is passed straight to
 * the Anthropic API, so a typo would fail every chat turn, and an arbitrary
 * string would let a database edit point customer traffic at any model — with
 * any price — outside the rate table above.
 *
 * Ordered cheapest first, which is also the order shown in the admin UI.
 */
export const CHAT_MODELS = [
  {
    id: "claude-3-5-haiku-20241022",
    label: "Haiku 3.5",
    note: "Cheapest. Good for library lookups and short answers.",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    note: "Faster and stronger than Haiku 3.5, still inexpensive.",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5",
    note: "Best reasoning. Roughly 4x the input cost of Haiku 3.5.",
  },
] as const;

/**
 * Default chat model. Haiku because the workbook library is re-sent as system
 * context on every turn, so input token price dominates chat spend.
 */
export const DEFAULT_CHAT_MODEL = "claude-3-5-haiku-20241022";

export function isAllowedChatModel(model: unknown): boolean {
  return typeof model === "string" && CHAT_MODELS.some((m) => m.id === model);
}

/** Resolve a stored value to a usable model id, falling back to the default. */
export function resolveChatModel(stored: string | null | undefined): string {
  return isAllowedChatModel(stored) ? (stored as string) : DEFAULT_CHAT_MODEL;
}
