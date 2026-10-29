import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_DAYS,
  checkInvite,
  hashInviteToken,
  inviteExpiry,
  isPlausibleInviteToken,
  newInviteToken,
} from "./invite-token";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const row = (over: Partial<Parameters<typeof checkInvite>[0] & object> = {}) => ({
  email: "a@b.com",
  expires_at: new Date(NOW + 1000).toISOString(),
  revoked_at: null,
  accepted_at: null,
  ...over,
});

describe("invite tokens", () => {
  it("stores only a hash of a random url-safe token", () => {
    const { token, hash } = newInviteToken();
    expect(isPlausibleInviteToken(token)).toBe(true);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
    expect(newInviteToken().token).not.toBe(token);
  });

  it("expires 7 days after it is sent", () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(Date.parse(inviteExpiry(NOW)) - NOW).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("works until it expires, is replaced or is accepted", () => {
    expect(checkInvite(row(), NOW)).toEqual({ ok: true, email: "a@b.com" });
    expect(checkInvite(row({ expires_at: new Date(NOW - 1).toISOString() }), NOW)).toEqual({ ok: false, reason: "expired" });
    expect(checkInvite(row({ revoked_at: "x" }), NOW)).toEqual({ ok: false, reason: "replaced" });
    expect(checkInvite(row({ accepted_at: "x" }), NOW)).toEqual({ ok: false, reason: "accepted" });
    expect(checkInvite(null, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(isPlausibleInviteToken("")).toBe(false);
    expect(isPlausibleInviteToken("../../etc")).toBe(false);
    expect(isPlausibleInviteToken(null)).toBe(false);
  });
});
