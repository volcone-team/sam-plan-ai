import { describe, it, expect } from "vitest";
import {
  normalizeLeadTimes, targetDateFor, isEligibleStatus, selectRecipients,
  type ProfileLike,
} from "./logic";

describe("normalizeLeadTimes", () => {
  it("keeps positive ints, dedupes, sorts (Req 1.4)", () => {
    expect(normalizeLeadTimes([2, 7, 2, 1])).toEqual([1, 2, 7]);
  });
  it("drops zero, negatives, non-ints, non-arrays", () => {
    expect(normalizeLeadTimes([0, -3, 2.5, "x", 3])).toEqual([3]);
    expect(normalizeLeadTimes("nope")).toEqual([]);
    expect(normalizeLeadTimes(null)).toEqual([]);
  });
});

describe("targetDateFor (Req 1.1)", () => {
  it("computes exactly N days ahead in UTC", () => {
    const today = new Date("2026-09-23T13:00:00Z");
    expect(targetDateFor(today, 2)).toBe("2026-09-25");
    expect(targetDateFor(today, 7)).toBe("2026-09-30");
    expect(targetDateFor(today, 1)).toBe("2026-09-24");
  });
  it("crosses month boundaries", () => {
    expect(targetDateFor(new Date("2026-09-30T23:00:00Z"), 2)).toBe("2026-10-02");
  });
  it("is stable regardless of time-of-day", () => {
    expect(targetDateFor(new Date("2026-09-23T00:01:00Z"), 2))
      .toBe(targetDateFor(new Date("2026-09-23T23:59:00Z"), 2));
  });
});

describe("isEligibleStatus (Req 1.3)", () => {
  it("includes upcoming, excludes finished/paused", () => {
    for (const s of ["planned", "in_progress", "launched"]) expect(isEligibleStatus(s)).toBe(true);
    for (const s of ["completed", "paused", "retired", "archived"]) expect(isEligibleStatus(s)).toBe(false);
  });
});

describe("selectRecipients (Req 4)", () => {
  const profiles: ProfileLike[] = [
    { id: "o", email: "o@x.com", role: "owner" },
    { id: "op", email: "op@x.com", role: "operator" },
    { id: "tm", email: "tm@x.com", role: "team_member" },
    { id: "v", email: "v@x.com", role: "viewer" },
    { id: "noemail", email: "", role: "owner" },
  ];
  it("owners_operators excludes team_member/viewer (Req 4.2)", () => {
    const r = selectRecipients(profiles, "owners_operators", new Set());
    expect(r.map((p) => p.id).sort()).toEqual(["o", "op"]);
  });
  it("all includes everyone with an email", () => {
    const r = selectRecipients(profiles, "all", new Set());
    expect(r.map((p) => p.id).sort()).toEqual(["o", "op", "tm", "v"]);
  });
  it("drops profiles with no email (Req 4.3)", () => {
    const r = selectRecipients(profiles, "all", new Set());
    expect(r.find((p) => p.id === "noemail")).toBeUndefined();
  });
  it("excludes opted-out users (Req 4.4 / 5.3)", () => {
    const r = selectRecipients(profiles, "all", new Set(["o", "tm"]));
    expect(r.map((p) => p.id).sort()).toEqual(["op", "v"]);
  });
});
