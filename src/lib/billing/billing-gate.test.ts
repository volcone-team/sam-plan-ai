import { describe, it, expect } from "vitest";
import { decideBillingGate, decideChoosePlanPage, type GateSubRow } from "./billing-gate";
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
