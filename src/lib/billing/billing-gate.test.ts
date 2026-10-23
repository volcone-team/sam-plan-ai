import { describe, it, expect } from "vitest";
import {
  decideAccessGates,
  decideBillingGate,
  decideChoosePlanPage,
  type GateSubRow,
} from "./billing-gate";
import type { CallGateCompany } from "@/lib/access/call-gate";
import { evaluateAccess, type BillingSettings } from "./entitlement";
import { shouldClearPauseOnSync, PAUSE_CLEAR_PATCH } from "./webhook-logic";

const ON: BillingSettings = { stripeEnabled: true, trialEnabled: false, trialDays: 14, dunningGraceDays: 7 };

const ROW: GateSubRow = {
  is_paused: false,
  pause_resumes_at: null,
  status: "active",
  stripe_status: "active",
  is_comped: false,
  comped_until: null,
  trial_ends_at: null,
  current_period_end: null,
  past_due_since: null,
  cancel_at_period_end: false,
  stripe_subscription_id: "sub_test_abc123",
  stripe_mode: "live",
};

const gate = (sub: GateSubRow | null, pathname: string, isAdmin = false) =>
  decideBillingGate({ isAdmin, hasCompany: true, sub, settings: ON, pathname }).kind;

describe("decideBillingGate", () => {
  it("passes an active subscriber and a super admin", () => {
    expect(gate(ROW, "/settings")).toBe("pass");
    expect(gate({ ...ROW, is_paused: true }, "/settings", true)).toBe("pass");
  });

  it("paused + live sub is paused everywhere, including the purchase journey", () => {
    const paused = { ...ROW, is_paused: true };
    for (const p of ["/settings", "/api/stripe/checkout", "/api/billing/me", "/api/me"]) {
      expect(gate(paused, p), p).toBe("paused");
    }
  });

  it("paused + canceled sub reaches the purchase journey, nothing else", () => {
    const paused = { ...ROW, is_paused: true, stripe_status: "canceled", status: "cancelled" };
    expect(gate(paused, "/api/stripe/checkout")).toBe("pass");
    expect(gate(paused, "/api/billing/reconcile")).toBe("pass");
    expect(gate(paused, "/settings")).toBe("paused");
    expect(gate(paused, "/api/stripe/portal")).toBe("paused");
    expect(gate(paused, "/api/me/password")).toBe("paused");
  });

  it("canceled, not paused: purchase required, reason canceled", () => {
    const canceled = { ...ROW, stripe_status: null, status: "cancelled" };
    expect(decideBillingGate({ isAdmin: false, hasCompany: true, sub: canceled, settings: ON, pathname: "/settings" }))
      .toEqual({ kind: "purchase", reason: "canceled" });
    expect(gate(canceled, "/api/stripe/checkout")).toBe("pass");
  });
});

/**
 * The two middleware gates together.
 *
 * The call gate's own rules are tested in src/lib/access/call-gate.test.ts.
 * What is pinned HERE is the thing neither function can state on its own: the
 * ORDER, and the fact that an unapplied migration 043 cannot block anybody.
 */
describe("decideAccessGates", () => {
  const WAITING: CallGateCompany = {
    requires_call_unlock: true,
    portal_access_granted_at: null,
  };

  const decide = (
    company: CallGateCompany | null,
    pathname: string,
    opts?: { sub?: GateSubRow | null; isAdmin?: boolean; method?: string }
  ) =>
    decideAccessGates({
      isAdmin: opts?.isAdmin ?? false,
      hasCompany: true,
      sub: opts?.sub === undefined ? ROW : opts.sub,
      settings: ON,
      company,
      pathname,
      method: opts?.method,
    }).kind;

  it("blocks a paid company that is still waiting for its call", () => {
    expect(decide(WAITING, "/year-at-a-glance")).toBe("awaiting_call");
    expect(decide(WAITING, "/intake/start")).toBe("awaiting_call");
    expect(decide(WAITING, "/settings")).toBe("awaiting_call");
    expect(decide(WAITING, "/api/plan/year", { method: "POST" })).toBe("awaiting_call");
  });

  it("lets a waiting company reach the thank-you page and sign out", () => {
    expect(decide(WAITING, "/welcome")).toBe("pass");
    expect(decide(WAITING, "/auth/login")).toBe("pass");
    expect(decide(WAITING, "/auth/verify-code")).toBe("pass");
    expect(decide(WAITING, "/api/auth/2fa/send", { method: "POST" })).toBe("pass");
    expect(decide(WAITING, "/api/me")).toBe("pass");
  });

  it("never blocks a super admin", () => {
    expect(decide(WAITING, "/year-at-a-glance", { isAdmin: true })).toBe("pass");
  });

  it("never blocks when migration 043 is not applied, or the row is unreadable", () => {
    // null is what the middleware passes when the select fails — before 043 is
    // applied, that is EVERY request. Locking paying customers out because a
    // column is missing is the one unacceptable failure.
    expect(decide(null, "/year-at-a-glance")).toBe("pass");
    expect(decide({}, "/year-at-a-glance")).toBe("pass");
    expect(decide({ requires_call_unlock: null, portal_access_granted_at: null }, "/settings"))
      .toBe("pass");
  });

  it("never blocks a company that has had its call", () => {
    expect(
      decide(
        { requires_call_unlock: true, portal_access_granted_at: "2026-10-18T09:00:00.000Z" },
        "/year-at-a-glance"
      )
    ).toBe("pass");
  });

  /**
   * ORDER. The flag is stamped when the COMPANY is created, not when it pays,
   * so "waiting for a call" does not imply "has paid" — in the no-trial flow a
   * company is flagged from the moment it registers. Billing therefore goes
   * first: a company with nothing to its name is sent to buy a plan, and the
   * call gate only becomes the obstacle once there is an entitlement behind it.
   */
  it("asks for payment before it asks for a call", () => {
    const canceled: GateSubRow = { ...ROW, stripe_status: "canceled", status: "canceled" };
    expect(decide(WAITING, "/year-at-a-glance", { sub: canceled })).toBe("purchase");
    expect(decide(WAITING, "/year-at-a-glance", { sub: null })).toBe("purchase");
  });

  it("reports a pause before a call, for the same reason", () => {
    expect(decide(WAITING, "/year-at-a-glance", { sub: { ...ROW, is_paused: true } }))
      .toBe("paused");
  });

  /**
   * The call gate applies to ENTITLED companies only. A flagged company with no
   * entitlement must be able to buy: the call comes after payment.
   */
  it("lets an unentitled flagged company reach the purchase APIs", () => {
    expect(decide(WAITING, "/api/stripe/checkout", { sub: null, method: "POST" })).toBe("pass");
    expect(decide(WAITING, "/api/billing/reconcile", { sub: null, method: "POST" })).toBe("pass");
    const canceled: GateSubRow = { ...ROW, stripe_status: "canceled", status: "canceled" };
    expect(decide(WAITING, "/api/stripe/checkout", { sub: canceled, method: "POST" })).toBe("pass");
  });

  it("sends an unentitled flagged company to buy from a product API, not to the call", () => {
    expect(decide(WAITING, "/api/initiatives", { sub: null })).toBe("purchase");
    expect(decide(WAITING, "/api/initiatives", { sub: null, method: "POST" })).toBe("purchase");
  });

  it("still holds an entitled flagged company at the call gate, including for buying", () => {
    expect(decide(WAITING, "/year-at-a-glance")).toBe("awaiting_call");
    expect(decide(WAITING, "/api/stripe/checkout", { method: "POST" })).toBe("awaiting_call");
    const trial: GateSubRow = {
      ...ROW,
      status: "trialing",
      stripe_status: null,
      stripe_subscription_id: null,
      trial_ends_at: "2999-01-01T00:00:00.000Z",
    };
    expect(decide(WAITING, "/year-at-a-glance", { sub: trial })).toBe("awaiting_call");
    expect(decide(WAITING, "/api/stripe/checkout", { sub: trial, method: "POST" })).toBe("awaiting_call");
  });

  it("leaves an ungated company's billing answers exactly as they were", () => {
    const canceled: GateSubRow = { ...ROW, stripe_status: "canceled", status: "canceled" };
    expect(decide(null, "/settings")).toBe("pass");
    expect(decide(null, "/settings", { sub: canceled })).toBe("purchase");
    expect(decide(null, "/api/stripe/checkout", { sub: canceled })).toBe("pass");
  });
});

describe("decideChoosePlanPage", () => {
  const decide = (row: GateSubRow) =>
    decideChoosePlanPage(
      evaluateAccess(ON, {
        status: (row.stripe_status ?? row.status) as never,
        isComped: row.is_comped ?? false,
        compedUntil: row.comped_until,
        trialEndsAt: row.trial_ends_at,
        currentPeriodEnd: row.current_period_end,
        pastDueSince: row.past_due_since,
        cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
        isPaused: row.is_paused ?? false,
        pauseResumesAt: row.pause_resumes_at,
      }),
      row
    );

  it("routes each state", () => {
    expect(decide(ROW)).toBe("redirect_app");
    expect(decide({ ...ROW, is_paused: true })).toBe("redirect_paused");
    expect(decide({ ...ROW, is_paused: true, stripe_status: "canceled" })).toBe("render");
    expect(decide({ ...ROW, is_paused: true, stripe_status: "canceled", is_comped: true })).toBe("redirect_paused");
    expect(decide({ ...ROW, stripe_status: "canceled" })).toBe("render");
  });
});

describe("shouldClearPauseOnSync", () => {
  const pausedAt = "2026-10-16T10:00:00.000Z";
  const after = Date.parse("2026-10-16T11:00:00.000Z") / 1000;
  const before = Date.parse("2026-10-01T00:00:00.000Z") / 1000;
  const base = { isPaused: true, pausedAt, incomingStatus: "active", incomingCreated: after, incomingHasPauseCollection: false };

  it("clears for a live subscription bought after the pause", () => {
    expect(shouldClearPauseOnSync(base)).toBe(true);
  });

  it("keeps the pause otherwise", () => {
    expect(shouldClearPauseOnSync({ ...base, isPaused: false })).toBe(false);
    expect(shouldClearPauseOnSync({ ...base, incomingStatus: "incomplete" })).toBe(false);
    expect(shouldClearPauseOnSync({ ...base, incomingHasPauseCollection: true })).toBe(false);
    expect(shouldClearPauseOnSync({ ...base, incomingCreated: before })).toBe(false);
    expect(shouldClearPauseOnSync({ ...base, pausedAt: null })).toBe(false);
    expect(shouldClearPauseOnSync({ ...base, pausedAt: "garbage" })).toBe(false);
  });

  it("clears every pause column", () => {
    expect(PAUSE_CLEAR_PATCH).toEqual({
      is_paused: false,
      paused_at: null,
      paused_by: null,
      pause_reason: null,
      pause_resumes_at: null,
      pause_origin: null,
      pause_reminder_sent_at: null,
    });
  });
});

/**
 * Why the middleware skips these gates for the impersonation exit endpoint.
 *
 * NOT a hypothetical. An admin impersonates a customer in order to look at a
 * problem, and the most common problem is a locked-out or paused account. Both
 * gates answer an API request from such an account with 402 / 403, and
 * `/api/admin/impersonate/exit` is an API route that appears in neither
 * allowance — so the Exit button, the account menu and
 * /auth/impersonation-ended all failed together for exactly the companies an
 * admin is most likely to be viewing.
 *
 * These assertions pin that fact in place. The fix is NOT here (the allow
 * lists are deliberately untouched, so nothing else gains an exemption): the
 * middleware refuses to consult the gate for this one path, before it runs.
 * If someone ever "simplifies" that away, these tests document what breaks.
 */
describe("impersonation exit vs the billing gates", () => {
  const EXIT = "/api/admin/impersonate/exit";

  it("would be refused by the paused gate", () => {
    expect(gate({ ...ROW, is_paused: true }, EXIT)).toBe("paused");
  });

  it("would be refused by the entitlement gate", () => {
    const lockedOut: GateSubRow = {
      ...ROW,
      status: "canceled",
      stripe_status: "canceled",
      stripe_subscription_id: null,
    };
    expect(gate(lockedOut, EXIT)).toBe("purchase");
  });

  it("is still refused for an account that is merely fine", () => {
    // Sanity: the exemption lives in the middleware, not in this function, so
    // a healthy account passing here proves nothing about the exemption.
    expect(gate(ROW, EXIT)).toBe("pass");
  });
});
