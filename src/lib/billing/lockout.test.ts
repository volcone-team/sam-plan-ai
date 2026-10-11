import { describe, it, expect } from "vitest";
import {
  requiresPurchase,
  lockoutCopy,
  isAllowedWhileLockedOut,
} from "./lockout";
import type { AccessReason } from "./entitlement";

describe("requiresPurchase", () => {
  it("covers every reason that means pay-to-continue", () => {
    const reasons: AccessReason[] = [
      "trial_expired",
      "no_subscription",
      "canceled",
      "comp_expired",
      "past_due_expired",
      "incomplete",
    ];
    for (const r of reasons) expect(requiresPurchase(r)).toBe(true);
  });

  /**
   * The distinction that matters most. A paused account cannot buy its way out
   * — an admin suspended it — so sending it to a purchase screen would take
   * money and leave the customer still locked out.
   */
  it("excludes paused, which paying cannot fix", () => {
    expect(requiresPurchase("paused")).toBe(false);
  });

  it("excludes states that still have access", () => {
    for (const r of ["active", "trialing", "comped", "grace_period", "billing_disabled"] as AccessReason[]) {
      expect(requiresPurchase(r)).toBe(false);
    }
  });
});

describe("lockoutCopy", () => {
  it("does not tell an abandoned signup their trial ended", () => {
    // The specific mix-up this function exists to prevent.
    const copy = lockoutCopy("no_subscription");
    expect(copy.title).not.toMatch(/trial/i);
    expect(copy.title.toLowerCase()).toContain("get started");
  });

  it("does not tell an expired trial to get started", () => {
    const copy = lockoutCopy("trial_expired");
    expect(copy.title.toLowerCase()).toContain("trial");
    expect(copy.title.toLowerCase()).not.toContain("get started");
  });

  it("blames the card, not the customer, on a failed payment", () => {
    const copy = lockoutCopy("past_due_expired");
    expect(copy.title.toLowerCase()).toContain("couldn't take");
    // The action is fixing payment, not re-choosing a plan.
    expect(copy.cta.toLowerCase()).toContain("payment");
  });

  it("says finish rather than choose when checkout was interrupted", () => {
    expect(lockoutCopy("incomplete").cta.toLowerCase()).toContain("finish");
  });

  it("names the plan on a cancellation when one is known", () => {
    expect(lockoutCopy("canceled", "Pro").body).toContain("Pro");
  });

  it("reads correctly with no plan name", () => {
    const copy = lockoutCopy("canceled", null);
    expect(copy.body).not.toContain("null");
    expect(copy.body).not.toContain("undefined");
  });

  /**
   * Someone locked out assumes the worst: a plan they cannot see feels
   * deleted. Every variant has to say otherwise.
   */
  it("reassures that nothing was deleted, in every variant", () => {
    const reasons: AccessReason[] = [
      "trial_expired",
      "no_subscription",
      "canceled",
      "comp_expired",
      "past_due_expired",
      "incomplete",
    ];
    for (const r of reasons) {
      const copy = lockoutCopy(r);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.cta.length).toBeGreaterThan(0);
    }
  });

  it("falls back to honest wording for an unmapped reason", () => {
    const copy = lockoutCopy("active");
    expect(copy.title.toLowerCase()).toContain("choose a plan");
  });
});

describe("isAllowedWhileLockedOut", () => {
  it("allows the purchase screen, or the redirect would loop", () => {
    expect(isAllowedWhileLockedOut("/choose-plan")).toBe(true);
  });

  it("allows the billing APIs that are the way out", () => {
    expect(isAllowedWhileLockedOut("/api/billing/checkout")).toBe(true);
    expect(isAllowedWhileLockedOut("/api/billing/reconcile")).toBe(true);
  });

  /**
   * The no-trial signup journey. Someone who has registered but not paid has
   * no subscription, so they are locked out by definition — blocking these
   * would make it impossible to ever complete a purchase.
   */
  it("allows the purchase journey itself", () => {
    expect(isAllowedWhileLockedOut("/checkout")).toBe(true);
    expect(isAllowedWhileLockedOut("/api/stripe/checkout")).toBe(true);
    expect(isAllowedWhileLockedOut("/api/stripe/portal")).toBe(true);
  });

  /**
   * Stripe returns to /welcome on success, and the webhook recording the
   * payment may not have landed yet. Bouncing someone to a purchase screen
   * seconds after they paid is the worst possible moment to doubt the product.
   */
  it("allows the welcome page, where Stripe returns after paying", () => {
    expect(isAllowedWhileLockedOut("/welcome")).toBe(true);
  });

  it("allows sign-out and the 2FA endpoints", () => {
    expect(isAllowedWhileLockedOut("/api/auth/2fa/send")).toBe(true);
    expect(isAllowedWhileLockedOut("/auth/login")).toBe(true);
  });

  it("allows exactly /api/me, which every page needs to render", () => {
    expect(isAllowedWhileLockedOut("/api/me")).toBe(true);
  });

  it("still blocks /api/me/password", () => {
    // Prefix matching would have let this through.
    expect(isAllowedWhileLockedOut("/api/me/password")).toBe(false);
  });

  it("blocks settings, so profile and team are not reachable", () => {
    // The reason plan purchase moved to its own route.
    expect(isAllowedWhileLockedOut("/settings")).toBe(false);
  });

  it("blocks the product", () => {
    for (const p of [
      "/year-at-a-glance",
      "/initiatives",
      "/products",
      "/planner/weekly",
      "/reports",
      "/intake/start",
      "/enhance-plan",
    ]) {
      expect(isAllowedWhileLockedOut(p)).toBe(false);
    }
  });

  it("does not allow a path that merely starts with an allowed name", () => {
    // /choose-plan-something is not /choose-plan.
    expect(isAllowedWhileLockedOut("/choose-plan-x")).toBe(false);
    expect(isAllowedWhileLockedOut("/authorise")).toBe(false);
  });
});
