/**
 * What a confirmation-email resend actually did, and what to tell the user.
 *
 * WHY THIS EXISTS: the first version swallowed every error and announced "a new
 * link is on its way" regardless. Supabase refuses a resend inside its
 * cooldown with 429 `over_email_send_rate_limit` and issues NO new token — so
 * the user was told their old link had stopped working when it was in fact
 * still the only valid one. Verified against the live auth server in
 * scripts/test-confirm-token-rotation.mjs.
 *
 * Pure, so the mapping is unit-tested rather than discovered in an inbox.
 */

export type ResendOutcome =
  /** A new token was issued. Every earlier link is now dead. */
  | { kind: "sent"; cooldownSeconds: number }
  /** Refused inside the cooldown. NO new token — the previous link still works. */
  | { kind: "throttled"; retryAfterSeconds: number }
  /** Too many emails for this address over a longer window. */
  | { kind: "limit_reached" }
  /** Anything else: network, server, misconfiguration. Nothing was sent. */
  | { kind: "failed" };

/** Supabase's per-address cooldown between confirmation emails. */
export const DEFAULT_COOLDOWN_SECONDS = 60;

interface ResendErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * Pull the wait time out of Supabase's message, e.g.
 * "For security purposes, you can only request this after 59 seconds."
 */
export function parseRetryAfter(message: string | undefined): number | null {
  if (!message) return null;
  const match = /after\s+(\d+)\s*second/i.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function interpretResendResult(
  error: ResendErrorLike | null | undefined
): ResendOutcome {
  if (!error) {
    return { kind: "sent", cooldownSeconds: DEFAULT_COOLDOWN_SECONDS };
  }

  const isRateLimit =
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    /rate limit/i.test(error.message ?? "");

  if (isRateLimit) {
    const retryAfter = parseRetryAfter(error.message);
    /*
     * With a wait time it is the short per-address cooldown. Without one it is
     * the longer project-wide email cap, where the honest answer is "later",
     * not a countdown that would expire into another refusal.
     */
    return retryAfter !== null
      ? { kind: "throttled", retryAfterSeconds: retryAfter }
      : { kind: "limit_reached" };
  }

  return { kind: "failed" };
}
