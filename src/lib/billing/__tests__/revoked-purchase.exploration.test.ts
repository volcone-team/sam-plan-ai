/**
 * Property 5: Bug Condition (Unit C, billing after grant then revoke)
 * A revoked customer can buy a plan.
 *
 * isBugCondition_C(company): comp granted then revoked, not comped now, no
 * live Stripe subscription, and the purchase screen the owner is shown cannot
 * complete a purchase.
 *
 * CRITICAL: these tests were written to FAIL on unfixed code (task 19.1).
 * Every decision goes through a `*UnderTest` function. Before the fix each was
 * a verbatim copy of today's inline logic:
 *   - /api/billing/me `hasStripeSubscription` (id present + mode tag only)
 *   - middleware paused + entitlement gate (src/lib/supabase/middleware.ts)
 *   - /choose-plan page redirects (src/app/choose-plan/page.tsx)
 *   - /api/stripe/change-plan pre-Stripe guards
 *   - webhook sync (never touched the pause columns)
 * Task 19.5 pointed them at the new helpers and re-ran this SAME file.
 *
 * **Validates: Requirements 1.9, 1.11, 2.12, 2.13, 2.14**
 */
import { describe, it, expect } from "vitest";
import { evaluateAccess, type BillingSettings } from "../entitlement";
import { lockoutCopy } from "../lockout";
import { hasLiveStripeSubscription, changePlanGuard } from "../live-subscription";
import { decideBillingGate, decideChoosePlanPage, type GateSubRow } from "../billing-gate";
import { shouldClearPauseOnSync } from "../webhook-logic";

const SETTINGS: BillingSettings = {
  stripeEnabled: true,
  trialEnabled: false,
  trialDays: 14,
  dunningGraceDays: 7,
};

/** Volcone Admin `5348835c` after grant → revoke (task 13/14 probe). */
const REVOKED: GateSubRow = {
  is_paused: false,
  pause_resumes_at: null,
  status: "cancelled",
  stripe_status: "canceled",
  is_comped: false,
  comped_until: null,
  trial_ends_at: null,
  current_period_end: "2027-10-08T14:33:12+00:00",
  past_due_since: null,
  cancel_at_period_end: false,
  stripe_subscription_id: "sub_test_lFBebS",
  stripe_mode: "live",
};

const PAUSED_NO_LIVE: GateSubRow = { ...REVOKED, is_paused: true };

/* ---------------- computeUnderTest (pointed at the helpers) --------------- */

function hasStripeSubscriptionUnderTest(row: GateSubRow): boolean {
  return hasLiveStripeSubscription(row);
}

/** billing-panel.tsx: picker action from the flag (unchanged by the fix). */
function panelActionUnderTest(hasStripeSubscription: boolean): "change_plan" | "checkout" {
  return hasStripeSubscription ? "change_plan" : "checkout";
}

function gateUnderTest(args: {
  isAdmin: boolean;
  row: GateSubRow | null;
  pathname: string;
}): "pass" | "paused" | "purchase" {
  return decideBillingGate({
    isAdmin: args.isAdmin,
    hasCompany: true,
    sub: args.row,
    settings: SETTINGS,
    pathname: args.pathname,
  }).kind;
}

function choosePlanPageUnderTest(row: GateSubRow): "redirect_paused" | "redirect_app" | "render" {
  const access = evaluateAccess(SETTINGS, {
    status: (row.stripe_status ?? row.status) as never,
    isComped: row.is_comped ?? false,
    compedUntil: row.comped_until,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    pastDueSince: row.past_due_since,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
    isPaused: row.is_paused ?? false,
    pauseResumesAt: row.pause_resumes_at,
  });
  return decideChoosePlanPage(access, row);
}

type GuardResult = { ok: true } | { ok: false; status: number; error: string };

function changePlanGuardUnderTest(row: GateSubRow): GuardResult {
  return changePlanGuard(row);
}

function webhookClearsPauseUnderTest(args: {
  isPaused: boolean;
  pausedAt: string | null;
  incomingStatus: string;
  incomingCreated: number;
  incomingHasPauseCollection: boolean;
}): boolean {
  return shouldClearPauseOnSync(args);
}

/* --------------------------------- tests --------------------------------- */

describe("Property 5: a revoked customer can buy a plan", () => {
  it("(a) a canceled sub id is not a subscription, so the panel offers Checkout", () => {
    const flag = hasStripeSubscriptionUnderTest(REVOKED);
    expect(flag).toBe(false);
    expect(panelActionUnderTest(flag)).toBe("checkout");
  });

  it("(a) every non-live Stripe status is treated as no subscription", () => {
    for (const s of ["canceled", "incomplete", "incomplete_expired", "paused", null]) {
      const row = { ...REVOKED, stripe_status: s };
      expect(panelActionUnderTest(hasStripeSubscriptionUnderTest(row)), String(s)).toBe("checkout");
    }
  });

  it("(b) paused + no live sub: a non-admin owner can reach a Checkout entry point", () => {
    expect(gateUnderTest({ isAdmin: false, row: PAUSED_NO_LIVE, pathname: "/api/stripe/checkout" })).toBe("pass");
    expect(gateUnderTest({ isAdmin: false, row: PAUSED_NO_LIVE, pathname: "/api/billing/me" })).toBe("pass");
    expect(gateUnderTest({ isAdmin: false, row: PAUSED_NO_LIVE, pathname: "/api/me" })).toBe("pass");
    expect(choosePlanPageUnderTest(PAUSED_NO_LIVE)).toBe("render");
    expect(panelActionUnderTest(hasStripeSubscriptionUnderTest(PAUSED_NO_LIVE))).toBe("checkout");
  });

  it("(b) paused + no sub id at all: same outcome", () => {
    const row = { ...PAUSED_NO_LIVE, stripe_subscription_id: null, stripe_status: null };
    expect(gateUnderTest({ isAdmin: false, row, pathname: "/api/stripe/checkout" })).toBe("pass");
    expect(choosePlanPageUnderTest(row)).toBe("render");
  });

  it("(b) the purchase that completes ends the pause (webhook)", () => {
    expect(
      webhookClearsPauseUnderTest({
        isPaused: true,
        pausedAt: "2026-10-16T10:00:00.000Z",
        incomingStatus: "active",
        incomingCreated: Date.parse("2026-10-16T11:00:00.000Z") / 1000,
        incomingHasPauseCollection: false,
      })
    ).toBe(true);
  });

  it("(c) status 'cancelled' with no stripe_status reads as canceled, with matching copy", () => {
    const access = evaluateAccess(SETTINGS, {
      status: "cancelled" as never,
      isComped: false,
      compedUntil: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      pastDueSince: null,
      cancelAtPeriodEnd: false,
    });
    expect(access.reason).toBe("canceled");
    expect(lockoutCopy(access.reason).title).toBe("Your subscription has ended");
  });

  it("(d) change-plan refuses a non-live sub with a clear 409 before calling Stripe", () => {
    expect(changePlanGuardUnderTest(REVOKED)).toEqual({
      ok: false,
      status: 409,
      error: "no_live_subscription",
    });
  });
});
