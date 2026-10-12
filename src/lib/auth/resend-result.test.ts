import { describe, it, expect } from "vitest";
import {
  interpretResendResult,
  parseRetryAfter,
  DEFAULT_COOLDOWN_SECONDS,
} from "./resend-result";

describe("parseRetryAfter", () => {
  it("reads the seconds from Supabase's cooldown message", () => {
    expect(
      parseRetryAfter("For security purposes, you can only request this after 59 seconds.")
    ).toBe(59);
  });

  it("handles the singular", () => {
    expect(parseRetryAfter("you can only request this after 1 second.")).toBe(1);
  });

  it("returns null when there is no number", () => {
    expect(parseRetryAfter("Email rate limit exceeded")).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
  });

  it("rejects zero rather than producing an instant retry", () => {
    expect(parseRetryAfter("request this after 0 seconds")).toBeNull();
  });
});

describe("interpretResendResult", () => {
  it("no error means a new token was issued", () => {
    expect(interpretResendResult(null)).toEqual({
      kind: "sent",
      cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
    });
    expect(interpretResendResult(undefined).kind).toBe("sent");
  });

  /*
   * THE BUG THIS MODULE FIXES. The exact response captured from the live auth
   * server: a resend inside the cooldown. It must NOT read as "sent" — no new
   * token exists, so the old link is still the valid one.
   */
  it("the real 429 cooldown response is throttled, never sent", () => {
    const outcome = interpretResendResult({
      status: 429,
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 59 seconds.",
    });
    expect(outcome).toEqual({ kind: "throttled", retryAfterSeconds: 59 });
  });

  it("recognises the rate limit by code alone", () => {
    expect(
      interpretResendResult({
        code: "over_email_send_rate_limit",
        message: "request this after 30 seconds",
      })
    ).toEqual({ kind: "throttled", retryAfterSeconds: 30 });
  });

  it("recognises the rate limit by status alone", () => {
    expect(
      interpretResendResult({ status: 429, message: "after 12 seconds" }).kind
    ).toBe("throttled");
  });

  it("a rate limit with no wait time is the longer cap, not a countdown", () => {
    expect(
      interpretResendResult({ status: 429, message: "Email rate limit exceeded" })
    ).toEqual({ kind: "limit_reached" });
  });

  it("any other error is a failure, not a success", () => {
    expect(interpretResendResult({ status: 500, message: "Internal error" })).toEqual({
      kind: "failed",
    });
    expect(interpretResendResult({ message: "Failed to fetch" }).kind).toBe("failed");
  });
});
