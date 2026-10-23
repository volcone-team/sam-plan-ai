import { describe, it, expect } from "vitest";
import { SIGNUP_TRUST_WINDOW_MS, decideSignupTrust, type SignupTrustFacts } from "./signup-trust";

const NOW = Date.parse("2026-10-20T12:00:00Z");

function facts(overrides: Partial<SignupTrustFacts> = {}): SignupTrustFacts {
  return {
    verificationRequired: false,
    authUser: {
      created_at: new Date(NOW - 60_000).toISOString(),
      app_metadata: { provider: "email", signup_source: "direct_no_verify" },
    },
    profile: { role: "owner", is_admin: false },
    now: NOW,
    ...overrides,
  };
}

describe("decideSignupTrust", () => {
  it("grants a new direct-signup owner", () => {
    expect(decideSignupTrust(facts())).toEqual({ grant: true });
  });

  it("refuses when email verification is required", () => {
    expect(decideSignupTrust(facts({ verificationRequired: true }))).toEqual({
      grant: false,
      reason: "verification_required",
    });
  });

  it("refuses without an auth user", () => {
    expect(decideSignupTrust(facts({ authUser: null }))).toMatchObject({ reason: "no_auth_user" });
  });

  it("refuses accounts not created by the direct signup route", () => {
    expect(
      decideSignupTrust(facts({ authUser: { created_at: new Date(NOW).toISOString(), app_metadata: { provider: "email" } } }))
    ).toMatchObject({ reason: "not_direct_signup" });
    expect(
      decideSignupTrust(facts({ authUser: { created_at: new Date(NOW).toISOString(), app_metadata: null } }))
    ).toMatchObject({ reason: "not_direct_signup" });
  });

  it("grants at exactly 15 minutes and refuses one millisecond later", () => {
    const at = (age: number) =>
      decideSignupTrust(
        facts({
          authUser: {
            created_at: new Date(NOW - age).toISOString(),
            app_metadata: { signup_source: "direct_no_verify" },
          },
        })
      );
    expect(at(SIGNUP_TRUST_WINDOW_MS)).toEqual({ grant: true });
    expect(at(SIGNUP_TRUST_WINDOW_MS + 1)).toMatchObject({ reason: "account_too_old" });
  });

  it("refuses a missing, malformed or far-future created_at", () => {
    for (const created_at of [null, "not a date", new Date(NOW + 10 * 60_000).toISOString()]) {
      expect(
        decideSignupTrust(facts({ authUser: { created_at, app_metadata: { signup_source: "direct_no_verify" } } }))
      ).toMatchObject({ reason: "account_too_old" });
    }
  });

  it("refuses without a profile", () => {
    expect(decideSignupTrust(facts({ profile: null }))).toMatchObject({ reason: "no_profile" });
  });

  it("refuses admins, even owners", () => {
    expect(decideSignupTrust(facts({ profile: { role: "owner", is_admin: true } }))).toMatchObject({
      reason: "admin",
    });
  });

  it("refuses non-owners", () => {
    for (const role of ["member", "admin", null]) {
      expect(decideSignupTrust(facts({ profile: { role, is_admin: false } }))).toMatchObject({
        reason: "not_owner",
      });
    }
  });
});
