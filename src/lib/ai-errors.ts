/**
 * Classifying failures from the Anthropic API into something a user can act on.
 *
 * WHY THIS EXISTS. The generation route had a branch for an invalid API key and
 * nothing else, so every other provider failure fell through to a generic
 * handler that returned the raw SDK message with a 500. A customer pressing
 * Generate saw this on screen:
 *
 *   400 {"type":"error","error":{"type":"invalid_request_error","message":
 *   "Your credit balance is too low to access the Anthropic API..."}}
 *
 * That is an operator's billing problem leaking into a customer's screen as
 * what looks like a crash. It also names our provider and dumps a request id,
 * neither of which is a customer's business.
 *
 * Pure and separately tested because the classification depends on matching
 * provider error shapes that differ by failure mode, and getting it wrong means
 * either a misleading message or an unhandled 500.
 */

/** What went wrong, in terms the app can respond to. */
export type AiFailureKind =
  | "no_credit"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "timeout"
  | "bad_request"
  | "unknown";

export interface AiFailure {
  kind: AiFailureKind;
  /** Shown to the user. Never includes provider names, ids or raw payloads. */
  message: string;
  /**
   * HTTP status to answer with.
   *
   * 402 for exhausted credit: it is a billing condition on OUR side, not a
   * fault in the request, and a 500 would tell an operator to go looking for a
   * bug that does not exist.
   */
  status: number;
  /** True when retrying the identical request could plausibly succeed. */
  retryable: boolean;
}

/** Shape of what the SDK throws, read defensively — none of it is guaranteed. */
interface ErrorLike {
  status?: number;
  message?: string;
  name?: string;
  error?: {
    type?: string;
    message?: string;
    error?: { type?: string; message?: string };
  };
}

function textOf(err: ErrorLike): string {
  return [
    err.message,
    err.error?.message,
    err.error?.error?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function typeOf(err: ErrorLike): string {
  return (err.error?.error?.type ?? err.error?.type ?? "").toLowerCase();
}

/**
 * Classify a thrown provider error.
 *
 * Order matters: credit exhaustion arrives as a 400 `invalid_request_error`,
 * which is the same status and type as a genuinely malformed request. Only the
 * message distinguishes them, so it is checked FIRST — otherwise every
 * out-of-credit failure is reported as "something was wrong with the request",
 * sending an operator to debug the prompt instead of topping up the account.
 */
export function classifyAiFailure(err: unknown): AiFailure {
  const e = (err ?? {}) as ErrorLike;
  const text = textOf(e);
  const type = typeOf(e);

  // Credit exhausted. Phrased for the customer without naming the provider;
  // the server log carries the detail for whoever has to fix it.
  if (text.includes("credit balance is too low") || text.includes("insufficient credit")) {
    return {
      kind: "no_credit",
      message:
        "Plan generation is temporarily unavailable. Our team has been notified — " +
        "please try again shortly.",
      status: 402,
      // True in the sense that the identical request works once topped up,
      // but not on a timer the client should poll.
      retryable: false,
    };
  }

  if (
    e.status === 401 ||
    e.status === 403 ||
    type === "authentication_error" ||
    type === "permission_error" ||
    text.includes("api key is invalid") ||
    text.includes("invalid x-api-key")
  ) {
    return {
      kind: "auth",
      message:
        "Plan generation is temporarily unavailable due to a configuration problem. " +
        "Our team has been notified.",
      status: 503,
      retryable: false,
    };
  }

  if (e.status === 429 || type === "rate_limit_error") {
    return {
      kind: "rate_limit",
      message: "The AI service is busy right now. Please try again in a minute.",
      status: 429,
      retryable: true,
    };
  }

  if (e.status === 529 || type === "overloaded_error" || text.includes("overloaded")) {
    return {
      kind: "overloaded",
      message: "The AI service is overloaded right now. Please try again in a few minutes.",
      status: 503,
      retryable: true,
    };
  }

  if (
    e.name === "AbortError" ||
    type === "timeout_error" ||
    text.includes("timeout") ||
    text.includes("timed out")
  ) {
    return {
      kind: "timeout",
      message:
        "Generating your plan took too long and was stopped. Please try again — " +
        "your answers are saved.",
      status: 504,
      retryable: true,
    };
  }

  // A real malformed request, now that credit exhaustion has been separated out.
  if (e.status === 400 || type === "invalid_request_error") {
    return {
      kind: "bad_request",
      message:
        "We could not generate your plan from these answers. Please try again, " +
        "or contact support if it keeps happening.",
      status: 502,
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    message: "We could not generate your plan right now. Please try again.",
    status: 502,
    retryable: true,
  };
}

/**
 * Detail for the SERVER LOG only.
 *
 * Deliberately separate from `message`: the operator needs the provider's exact
 * wording and the request id to act, and the customer must not see either.
 */
export function aiFailureLogDetail(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  const parts = [
    e.status !== undefined ? `status=${e.status}` : null,
    typeOf(e) ? `type=${typeOf(e)}` : null,
    e.message ?? e.error?.message ?? e.error?.error?.message ?? null,
  ].filter(Boolean);
  return parts.join(" | ") || "no detail available";
}

/** Operator-facing note for failures someone has to go and fix. */
export function operatorHint(kind: AiFailureKind): string | null {
  switch (kind) {
    case "no_credit":
      return "ANTHROPIC CREDIT EXHAUSTED — add credit at console.anthropic.com (Plans & Billing). " +
        "Plan generation and chat will keep failing until then.";
    case "auth":
      return "ANTHROPIC KEY REJECTED — check ANTHROPIC_API_KEY is set and still valid.";
    default:
      return null;
  }
}
