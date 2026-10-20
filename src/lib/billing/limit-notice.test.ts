import { describe, it, expect } from "vitest";
import { capState, limitNoticeFrom, LimitReachedError, UPGRADE_URL } from "./limit-notice";

describe("limitNoticeFrom", () => {
  it("reads the live-limit shape (words in error, code in code)", () => {
    expect(
      limitNoticeFrom({ error: "Your Starter plan allows 2 products.", code: "limit_reached", message: "Your Starter plan allows 2 products." })
    ).toEqual({ code: "limit_reached", message: "Your Starter plan allows 2 products.", upgradeUrl: UPGRADE_URL });
  });

  it("reads the AI-route shape (code in error, words in message)", () => {
    expect(
      limitNoticeFrom({ error: "limit_reached", message: "You have used all 2 of your AI uses for this billing period." })
    ).toMatchObject({ code: "limit_reached", message: "You have used all 2 of your AI uses for this billing period." });
  });

  it("never shows a bare code as the message", () => {
    expect(limitNoticeFrom({ error: "not_included" })?.message).not.toBe("not_included");
  });

  it("ignores other errors and junk", () => {
    expect(limitNoticeFrom({ error: "Unauthorized" })).toBeNull();
    expect(limitNoticeFrom({ code: "ineligible", error: "x" })).toBeNull();
    expect(limitNoticeFrom(null)).toBeNull();
    expect(limitNoticeFrom("limit_reached")).toBeNull();
  });

  it("only accepts an in-app upgrade link", () => {
    expect(limitNoticeFrom({ code: "limit_reached", message: "m", upgradeUrl: "https://evil.example" })?.upgradeUrl).toBe(UPGRADE_URL);
  });

  it("LimitReachedError carries the notice", () => {
    const err = new LimitReachedError({ code: "limit_reached", message: "m", upgradeUrl: UPGRADE_URL });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("m");
  });
});

describe("capState", () => {
  it("caps at the limit and reports how far over", () => {
    expect(capState(1, 2)).toEqual({ canAdd: true, atCap: false, over: 0 });
    expect(capState(2, 2)).toEqual({ canAdd: false, atCap: true, over: 0 });
    expect(capState(3, 2)).toEqual({ canAdd: false, atCap: true, over: 1 });
  });

  it("does not cap when unlimited", () => {
    expect(capState(50, null)).toEqual({ canAdd: true, atCap: false, over: 0 });
  });
});
