/**
 * Client-safe description of a plan-limit refusal.
 *
 * Every server path that refuses for a plan limit answers with a body carrying
 * `code` ("limit_reached" or "not_included") and a human `message`. The AI
 * routes (generate-plan, enhance) predate that and put the CODE in `error`
 * with the words in `message`; both shapes are read here so a caller never
 * shows "limit_reached" as if it were a sentence.
 *
 * No server imports: this is used by pages and components.
 */

/** Where an owner goes to change plan. */
export const UPGRADE_URL = "/settings?tab=subscription";

export type LimitCode = "limit_reached" | "not_included";

export interface LimitNotice {
  code: LimitCode;
  message: string;
  upgradeUrl: string;
}

function isLimitCode(value: unknown): value is LimitCode {
  return value === "limit_reached" || value === "not_included";
}

/** The limit refusal in a response body, or null when it is some other error. */
export function limitNoticeFrom(body: unknown): LimitNotice | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const code = isLimitCode(b.code) ? b.code : isLimitCode(b.error) ? b.error : null;
  if (!code) return null;

  const text =
    typeof b.message === "string" && b.message.trim() !== ""
      ? b.message
      : typeof b.error === "string" && !isLimitCode(b.error) && b.error.trim() !== ""
        ? b.error
        : "Your plan's limit has been reached. Upgrade to add more.";

  return {
    code,
    message: text,
    upgradeUrl: typeof b.upgradeUrl === "string" && b.upgradeUrl.startsWith("/") ? b.upgradeUrl : UPGRADE_URL,
  };
}

/** Thrown by client helpers so a caller can tell a limit apart from a failure. */
export class LimitReachedError extends Error {
  readonly notice: LimitNotice;

  constructor(notice: LimitNotice) {
    super(notice.message);
    this.name = "LimitReachedError";
    this.notice = notice;
  }
}

/**
 * A client-side cap on how many items a form may hold, from a live limit.
 * `limit` null = no cap. Used by the intake products screen; the server's
 * check on the build is still the authority.
 */
export function capState(
  count: number,
  limit: number | null
): { canAdd: boolean; atCap: boolean; over: number } {
  if (limit === null || limit < 0) return { canAdd: true, atCap: false, over: 0 };
  return {
    canAdd: count < limit,
    atCap: count >= limit,
    over: Math.max(0, count - limit),
  };
}
