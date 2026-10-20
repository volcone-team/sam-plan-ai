import { describe, it, expect } from "vitest";
import {
  needsCallUnlock,
  isAllowedWhileAwaitingCall,
  decideCallGate,
  CALL_GATE_PAGE,
  type CallGateCompany,
} from "./call-gate";
import { IMPERSONATION_EXIT_PATH } from "@/lib/admin/impersonation-blocked";

/** Paths that stand in for "the product", used in several loops below. */
const PRODUCT_PATHS: readonly string[] = [
  "/year-at-a-glance",
  "/initiatives",
  "/products",
  "/planner/weekly",
  "/reports",
  "/enhance-plan",
  "/settings",
  "/intake/start",
  "/onboarding/welcome",
  "/api/plan/enhance",
  "/api/intake/build",
  "/api/me/password",
  "/api/team/create-member",
];

/**
 * Paths that exist to SELL, which the billing lockout allows and this gate
 * does not. The owner's decision: a blocked customer cannot buy either, they
 * have already paid.
 */
const PURCHASE_PATHS: readonly string[] = [
  "/choose-plan",
  "/checkout",
  "/get-started",
  "/api/billing/checkout",
  "/api/billing/reconcile",
  "/api/stripe/checkout",
  "/api/stripe/portal",
];

describe("needsCallUnlock", () => {
  it("is false when the flag is not set, whatever else is true", () => {
    // Every company that existed before migration 043 is this case, which is
    // why switching the gate on cannot block an existing customer.
    expect(needsCallUnlock({})).toBe(false);
    expect(needsCallUnlock({ requires_call_unlock: false })).toBe(false);
    expect(needsCallUnlock({ requires_call_unlock: null })).toBe(false);
    expect(
      needsCallUnlock({ requires_call_unlock: false, portal_access_granted_at: null })
    ).toBe(false);
  });

  it("is false for a missing company, and for a row read before 043 is applied", () => {
    expect(needsCallUnlock(null)).toBe(false);
    expect(needsCallUnlock(undefined)).toBe(false);
    // Columns absent entirely: the select simply returned neither field.
    expect(needsCallUnlock({} as CallGateCompany)).toBe(false);
  });

  it("is true when flagged with no grant", () => {
    expect(
      needsCallUnlock({ requires_call_unlock: true, portal_access_granted_at: null })
    ).toBe(true);
    expect(needsCallUnlock({ requires_call_unlock: true })).toBe(true);
  });

  it("is false once a grant exists, even though the flag stays set", () => {
    // The grant is kept rather than the flag cleared, so who-unlocked-when
    // survives. That must not re-lock anybody.
    expect(
      needsCallUnlock({
        requires_call_unlock: true,
        portal_access_granted_at: "2026-10-12T09:00:00Z",
      })
    ).toBe(false);
  });
});

describe("isAllowedWhileAwaitingCall", () => {
  it("allows the thank-you page, or the redirect would loop", () => {
    expect(isAllowedWhileAwaitingCall(CALL_GATE_PAGE)).toBe(true);
    expect(isAllowedWhileAwaitingCall("/welcome")).toBe(true);
    expect(isAllowedWhileAwaitingCall("/welcome?checkout=success")).toBe(false); // pathname only, no query
  });

  it("always allows signing in and out", () => {
    // The one way this feature could trap somebody is by making it impossible
    // to leave an account you cannot use.
    for (const p of ["/auth", "/auth/login", "/auth/verify-code", "/auth/confirmed"]) {
      expect(isAllowedWhileAwaitingCall(p)).toBe(true);
    }
    for (const p of ["/api/auth/2fa/send", "/api/auth/2fa/grant", "/api/auth/forgot-password"]) {
      expect(isAllowedWhileAwaitingCall(p)).toBe(true);
    }
  });

  it("allows exactly /api/me, which every page needs to render", () => {
    expect(isAllowedWhileAwaitingCall("/api/me")).toBe(true);
  });

  it("blocks DELETE /api/me, which would destroy the account", () => {
    expect(isAllowedWhileAwaitingCall("/api/me", "DELETE")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/api/me", "delete")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/api/me", "GET")).toBe(true);
  });

  it("allows the impersonation exit, or an admin could not get back out", () => {
    expect(isAllowedWhileAwaitingCall(IMPERSONATION_EXIT_PATH)).toBe(true);
    // But not the rest of the admin surface, for a customer session.
    expect(isAllowedWhileAwaitingCall("/api/admin/impersonate")).toBe(false);
  });

  it("blocks the product", () => {
    for (const p of PRODUCT_PATHS) {
      expect(isAllowedWhileAwaitingCall(p)).toBe(false);
    }
  });

  it("blocks buying, unlike the billing lockout", () => {
    for (const p of PURCHASE_PATHS) {
      expect(isAllowedWhileAwaitingCall(p)).toBe(false);
    }
  });

  it("respects path-segment boundaries", () => {
    // The mistakes a naive startsWith would make.
    expect(isAllowedWhileAwaitingCall("/api/mentions")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/api/members")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/api/me/password")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/welcome-back")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/authorise")).toBe(false);
    expect(isAllowedWhileAwaitingCall("/api/authorise")).toBe(false);
    // ...and the ones it should still allow.
    expect(isAllowedWhileAwaitingCall("/welcome/thanks")).toBe(true);
    expect(isAllowedWhileAwaitingCall("/auth/login")).toBe(true);
  });

  it("refuses an empty path rather than treating it as allowed", () => {
    expect(isAllowedWhileAwaitingCall("")).toBe(false);
  });
});

describe("decideCallGate", () => {
  const waiting: CallGateCompany = {
    requires_call_unlock: true,
    portal_access_granted_at: null,
  };
  const granted: CallGateCompany = {
    requires_call_unlock: true,
    portal_access_granted_at: "2026-10-12T09:00:00Z",
  };
  const neverGated: CallGateCompany = { requires_call_unlock: false };

  const ALL_PATHS: readonly string[] = [
    ...PRODUCT_PATHS,
    ...PURCHASE_PATHS,
    "/welcome",
    "/auth/login",
    "/api/auth/2fa/send",
    "/api/me",
    IMPERSONATION_EXIT_PATH,
    "/",
  ];

  it("never blocks a company without the flag, anywhere", () => {
    for (const pathname of ALL_PATHS) {
      expect(decideCallGate({ isAdmin: false, company: neverGated, pathname })).toEqual({
        blocked: false,
        reason: "not_gated",
      });
    }
  });

  it("never blocks a company that has had its call, anywhere", () => {
    for (const pathname of ALL_PATHS) {
      expect(decideCallGate({ isAdmin: false, company: granted, pathname })).toEqual({
        blocked: false,
        reason: "already_granted",
      });
    }
  });

  it("never blocks a super admin, anywhere, even one whose own company is waiting", () => {
    for (const pathname of ALL_PATHS) {
      expect(decideCallGate({ isAdmin: true, company: waiting, pathname })).toEqual({
        blocked: false,
        reason: "admin",
      });
    }
  });

  it("blocks a waiting company everywhere except the allow-list", () => {
    for (const pathname of ALL_PATHS) {
      const decision = decideCallGate({ isAdmin: false, company: waiting, pathname });
      const allowed = isAllowedWhileAwaitingCall(pathname);
      expect(decision.blocked).toBe(!allowed);
      expect(decision.reason).toBe(allowed ? "allowed_path" : "awaiting_call");
    }
  });

  it("blocks the dashboard and the intake for a waiting company", () => {
    for (const pathname of PRODUCT_PATHS) {
      expect(decideCallGate({ isAdmin: false, company: waiting, pathname }).blocked).toBe(true);
    }
  });

  /**
   * Stripe is a server calling a server: no session, so no company. The gate
   * passes rather than refusing, on top of the middleware never consulting it
   * for a public API route. Its absence from the public list was once an
   * outage; this is the belt to that braces.
   */
  it("passes when there is no company, which is what a webhook looks like", () => {
    for (const pathname of ["/api/stripe/webhook", "/api/cron/notifications"]) {
      expect(decideCallGate({ isAdmin: false, company: null, pathname })).toEqual({
        blocked: false,
        reason: "no_company",
      });
      expect(decideCallGate({ isAdmin: false, company: undefined, pathname }).blocked).toBe(false);
    }
  });

  /**
   * Until migration 043 is applied, selected rows have neither column. Nobody
   * may be gated by an unapplied migration.
   */
  it("passes for a company row read before migration 043 is applied", () => {
    for (const pathname of ALL_PATHS) {
      expect(decideCallGate({ isAdmin: false, company: {}, pathname }).blocked).toBe(false);
    }
  });

  it("is independent of the method except where the method is the decision", () => {
    expect(
      decideCallGate({ isAdmin: false, company: waiting, pathname: "/api/me", method: "GET" }).blocked
    ).toBe(false);
    expect(
      decideCallGate({ isAdmin: false, company: waiting, pathname: "/api/me", method: "DELETE" }).blocked
    ).toBe(true);
  });

  it("defaults to GET, which is what a page navigation is", () => {
    expect(decideCallGate({ isAdmin: false, company: waiting, pathname: "/api/me" }).blocked).toBe(
      false
    );
  });
});
