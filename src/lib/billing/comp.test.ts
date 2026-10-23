import { describe, it, expect } from "vitest";
import {
  parseCompInput,
  parseCreateGrant,
  createGrantErrorMessage,
  DEFAULT_COMP_REASON,
} from "./comp";

describe("parseCompInput", () => {
  it("requires a plan", () => {
    expect(parseCompInput({})).toEqual({ ok: false, error: "planId" });
    expect(parseCompInput({ planId: "  " })).toEqual({ ok: false, error: "planId" });
    expect(parseCompInput({ planId: 7 })).toEqual({ ok: false, error: "planId" });
  });

  it("treats a blank or absent end date as no expiry", () => {
    for (const until of [undefined, null, "", "   "]) {
      const r = parseCompInput({ planId: "p", until });
      expect(r).toEqual({ ok: true, value: { planId: "p", until: null, reason: DEFAULT_COMP_REASON } });
    }
  });

  it("normalises a date to ISO and rejects garbage", () => {
    const r = parseCompInput({ planId: "p", until: "2026-12-31" });
    expect(r.ok && r.value.until).toBe("2026-12-31T00:00:00.000Z");
    expect(parseCompInput({ planId: "p", until: "not a date" })).toEqual({ ok: false, error: "until" });
    expect(parseCompInput({ planId: "p", until: 123 })).toEqual({ ok: false, error: "until" });
  });

  it("trims and caps the reason, defaulting when blank", () => {
    const r = parseCompInput({ planId: "p", reason: "  partner  " });
    expect(r.ok && r.value.reason).toBe("partner");
    const long = parseCompInput({ planId: "p", reason: "x".repeat(400) });
    expect(long.ok && long.value.reason.length).toBe(300);
    const blank = parseCompInput({ planId: "p", reason: "  " });
    expect(blank.ok && blank.value.reason).toBe(DEFAULT_COMP_REASON);
  });
});

describe("parseCreateGrant (admin create request)", () => {
  it("means no grant when grantAccess is absent or false", () => {
    expect(parseCreateGrant({})).toEqual({ ok: true, grant: null });
    expect(parseCreateGrant({ grantAccess: false, planId: "p" })).toEqual({ ok: true, grant: null });
    expect(parseCreateGrant({ grantAccess: null })).toEqual({ ok: true, grant: null });
  });

  it("refuses a non-boolean flag rather than coercing it", () => {
    expect(parseCreateGrant({ grantAccess: "false" })).toEqual({ ok: false, error: "grantAccess" });
    expect(parseCreateGrant({ grantAccess: 1, planId: "p" })).toEqual({ ok: false, error: "grantAccess" });
  });

  it("maps compUntil and compReason onto the comp input", () => {
    expect(
      parseCreateGrant({
        grantAccess: true,
        planId: "plan-1",
        compUntil: "2027-01-15",
        compReason: "Set up by hand",
      })
    ).toEqual({
      ok: true,
      grant: { planId: "plan-1", until: "2027-01-15T00:00:00.000Z", reason: "Set up by hand" },
    });
  });

  it("requires a plan and a valid date when granting", () => {
    expect(parseCreateGrant({ grantAccess: true })).toEqual({ ok: false, error: "planId" });
    expect(parseCreateGrant({ grantAccess: true, planId: "p", compUntil: "nope" })).toEqual({
      ok: false,
      error: "until",
    });
  });

  it("has a readable message for every refusal", () => {
    for (const e of ["grantAccess", "planId", "until"] as const) {
      expect(createGrantErrorMessage(e).length).toBeGreaterThan(0);
    }
  });
});
