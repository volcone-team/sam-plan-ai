import { describe, it, expect } from "vitest";
import {
  LIVE_MODE_TAG,
  normaliseSubscriptionStatus,
  hasLiveStripeSubscription,
  canPurchaseWhilePaused,
  isAllowedWhilePausedWithoutSubscription,
  changePlanGuard,
} from "./live-subscription";
import { STRIPE_MODE_TAG } from "./stripe-client";
import { isAllowedWhileLockedOut } from "./lockout";

const LIVE_ROW = {
  stripe_subscription_id: "sub_test_abc123",
  stripe_mode: "live",
  stripe_status: "active",
  status: "active",
};

describe("live-subscription", () => {
  it("keeps the Edge-safe mode tag equal to STRIPE_MODE_TAG", () => {
    expect(LIVE_MODE_TAG).toBe(STRIPE_MODE_TAG);
  });

  it("normalises the British 'cancelled' and nothing else", () => {
    expect(normaliseSubscriptionStatus("cancelled")).toBe("canceled");
    expect(normaliseSubscriptionStatus("canceled")).toBe("canceled");
    expect(normaliseSubscriptionStatus("active")).toBe("active");
    expect(normaliseSubscriptionStatus(null)).toBeNull();
    expect(normaliseSubscriptionStatus(undefined)).toBeNull();
  });

  it("is live only with an id, the mode tag and a live status", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid"]) {
      expect(hasLiveStripeSubscription({ ...LIVE_ROW, stripe_status: s }), s).toBe(true);
    }
    for (const s of ["canceled", "cancelled", "incomplete", "incomplete_expired", "paused"]) {
      expect(hasLiveStripeSubscription({ ...LIVE_ROW, stripe_status: s }), s).toBe(false);
    }
    expect(hasLiveStripeSubscription({ ...LIVE_ROW, stripe_subscription_id: null })).toBe(false);
    expect(hasLiveStripeSubscription({ ...LIVE_ROW, stripe_mode: "test" })).toBe(false);
    expect(hasLiveStripeSubscription(null)).toBe(false);
  });

  it("falls back to status when stripe_status is null", () => {
    expect(hasLiveStripeSubscription({ ...LIVE_ROW, stripe_status: null, status: "active" })).toBe(true);
    expect(hasLiveStripeSubscription({ ...LIVE_ROW, stripe_status: null, status: "cancelled" })).toBe(false);
  });

  it("lets a paused account buy only when nothing live is behind the pause and it is not comped", () => {
    const canceled = { ...LIVE_ROW, stripe_status: "canceled", is_paused: true, is_comped: false };
    expect(canPurchaseWhilePaused(canceled)).toBe(true);
    expect(canPurchaseWhilePaused({ ...canceled, stripe_subscription_id: null })).toBe(true);
    expect(canPurchaseWhilePaused({ ...canceled, stripe_status: "active" })).toBe(false);
    expect(canPurchaseWhilePaused({ ...canceled, is_comped: true })).toBe(false);
    expect(canPurchaseWhilePaused({ ...canceled, is_paused: false })).toBe(false);
  });

  it("paused-purchase paths are a subset of the lockout allow-list", () => {
    const paths = [
      "/choose-plan", "/checkout", "/welcome", "/api/stripe/checkout", "/api/billing/me",
      "/api/billing/reconcile", "/api/me", "/api/auth/sign-out",
    ];
    for (const p of paths) {
      expect(isAllowedWhilePausedWithoutSubscription(p), p).toBe(true);
      expect(isAllowedWhileLockedOut(p), p).toBe(true);
    }
    for (const p of [
      "/api/me/password", "/api/stripe/portal", "/api/stripe/change-plan", "/api/billing/cancel",
      "/api/billing/resume", "/api/billing/pause", "/api/billing/retention-offer", "/settings",
      "/year-at-a-glance", "/api/billing/meta",
    ]) {
      expect(isAllowedWhilePausedWithoutSubscription(p), p).toBe(false);
    }
  });

  it("change-plan guard: comped, no id, not live, paused, ok — in that order", () => {
    expect(changePlanGuard({ ...LIVE_ROW, is_comped: true, stripe_status: "canceled" })).toEqual({
      ok: false, status: 400, error: "comped_account",
    });
    expect(changePlanGuard({ ...LIVE_ROW, stripe_subscription_id: null })).toEqual({
      ok: false, status: 404, error: "no_subscription",
    });
    expect(changePlanGuard({ ...LIVE_ROW, stripe_status: "canceled", is_paused: true })).toEqual({
      ok: false, status: 409, error: "no_live_subscription",
    });
    expect(changePlanGuard({ ...LIVE_ROW, is_paused: true })).toEqual({
      ok: false, status: 403, error: "account_paused",
    });
    expect(changePlanGuard(LIVE_ROW)).toEqual({ ok: true });
    expect(changePlanGuard(null)).toEqual({ ok: false, status: 404, error: "no_subscription" });
  });
});
