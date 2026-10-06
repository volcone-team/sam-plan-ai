import { describe, it, expect } from "vitest";
import {
  classifyAiFailure,
  aiFailureLogDetail,
  operatorHint,
} from "./ai-errors";

/**
 * The failure that prompted this: exhausted credit surfaced to a customer as
 * raw provider JSON with a 500, naming the provider and including a request id.
 * These assert each failure mode gets a usable message and an honest status.
 */

/** The actual error the SDK throws when the account is out of credit. */
const noCreditError = {
  status: 400,
  message:
    '400 {"type":"error","error":{"type":"invalid_request_error","message":' +
    '"Your credit balance is too low to access the Anthropic API. Please go to ' +
    'Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Cfm"}',
  error: {
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API.",
    },
  },
};

describe("classifyAiFailure", () => {
  it("identifies exhausted credit", () => {
    expect(classifyAiFailure(noCreditError).kind).toBe("no_credit");
  });

  // 402 not 500: it is a billing condition, and a 500 sends an operator
  // hunting a bug that does not exist.
  it("answers exhausted credit with 402", () => {
    expect(classifyAiFailure(noCreditError).status).toBe(402);
  });

  /**
   * Credit exhaustion arrives as a 400 invalid_request_error — identical status
   * and type to a malformed prompt. Only the message separates them, so this is
   * the ordering that matters most.
   */
  it("does not mistake exhausted credit for a bad request", () => {
    expect(classifyAiFailure(noCreditError).kind).not.toBe("bad_request");
  });

  it("never leaks the provider, request id or raw payload to the user", () => {
    const { message } = classifyAiFailure(noCreditError);
    expect(message).not.toMatch(/anthropic/i);
    expect(message).not.toMatch(/req_/);
    expect(message).not.toMatch(/credit balance/i);
    expect(message).not.toMatch(/\{|\}/);
  });

  it("identifies an invalid key", () => {
    const f = classifyAiFailure({ status: 401, message: "API key is invalid" });
    expect(f.kind).toBe("auth");
    expect(f.status).toBe(503);
  });

  it("treats a permission error as auth", () => {
    expect(classifyAiFailure({ status: 403 }).kind).toBe("auth");
  });

  it("identifies rate limiting as retryable", () => {
    const f = classifyAiFailure({ status: 429 });
    expect(f.kind).toBe("rate_limit");
    expect(f.status).toBe(429);
    expect(f.retryable).toBe(true);
  });

  it("identifies an overloaded provider", () => {
    const f = classifyAiFailure({ status: 529 });
    expect(f.kind).toBe("overloaded");
    expect(f.retryable).toBe(true);
  });

  it("identifies a timeout and reassures that answers are kept", () => {
    const f = classifyAiFailure({ name: "AbortError" });
    expect(f.kind).toBe("timeout");
    expect(f.status).toBe(504);
    expect(f.message).toMatch(/saved/i);
  });

  it("identifies a genuinely malformed request", () => {
    const f = classifyAiFailure({
      status: 400,
      error: { error: { type: "invalid_request_error", message: "max_tokens too large" } },
    });
    expect(f.kind).toBe("bad_request");
  });

  it("falls back to unknown without throwing", () => {
    expect(classifyAiFailure(null).kind).toBe("unknown");
    expect(classifyAiFailure(undefined).kind).toBe("unknown");
    expect(classifyAiFailure("a string").kind).toBe("unknown");
    expect(classifyAiFailure({}).kind).toBe("unknown");
  });

  it("always produces a non-empty message", () => {
    for (const input of [noCreditError, { status: 401 }, { status: 429 }, {}, null]) {
      expect(classifyAiFailure(input).message.length).toBeGreaterThan(10);
    }
  });
});

describe("aiFailureLogDetail", () => {
  // The inverse of the user message: the operator needs the exact wording.
  it("keeps the provider detail for the log", () => {
    const detail = aiFailureLogDetail(noCreditError);
    expect(detail).toMatch(/credit balance/i);
    expect(detail).toMatch(/status=400/);
  });

  it("does not throw on malformed input", () => {
    expect(aiFailureLogDetail(null)).toBe("no detail available");
    expect(aiFailureLogDetail({})).toBe("no detail available");
  });
});

describe("operatorHint", () => {
  it("tells an operator exactly what to do about exhausted credit", () => {
    const hint = operatorHint("no_credit");
    expect(hint).toMatch(/console\.anthropic\.com/);
    expect(hint).toMatch(/credit/i);
  });

  it("names the env var for a rejected key", () => {
    expect(operatorHint("auth")).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("has no hint for failures nobody needs to fix", () => {
    expect(operatorHint("rate_limit")).toBeNull();
    expect(operatorHint("timeout")).toBeNull();
  });
});
