import { describe, it, expect } from "vitest";
import {
  isHandledEvent,
  mapStripeStatus,
  subscriptionIdFromInvoice,
  extractPeriod,
  nextPastDueSince,
  shouldClearPending,
  shouldClearPendingChange,
  shouldClearComp,
  interpretClaim,
  webhookResponseStatus,
  isEnding,
  accessEndsAt,
  HANDLED_EVENTS,
} from "./webhook-logic";

/**
 * The webhook is the only writer of subscription state, so every case here maps
 * to a way a customer could pay and get nothing, or keep access they stopped
 * paying for.
 */

describe("isHandledEvent", () => {
  it("handles every event the endpoint subscribes to", () => {
    for (const type of HANDLED_EVENTS) {
      expect(isHandledEvent(type)).toBe(true);
    }
  });

  it("ignores unrelated events rather than failing on them", () => {
    for (const type of [
      "charge.succeeded", "payment_intent.created", "invoice.updated",
      "customer.created", "invoice_payment.paid",
    ]) {
      expect(isHandledEvent(type)).toBe(false);
    }
  });

  /** invoice.payment_succeeded duplicates invoice.paid; handling both would double-process. */
  it("does not handle invoice.payment_succeeded", () => {
    expect(isHandledEvent("invoice.payment_succeeded")).toBe(false);
  });
});

describe("mapStripeStatus", () => {
  it("maps the states that grant access", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("trial");
  });

  it("maps failing payment states to past_due", () => {
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
  });

  it("maps terminal states to cancelled", () => {
    expect(mapStripeStatus("canceled")).toBe("cancelled");
    expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
  });

  it("maps paused", () => {
    expect(mapStripeStatus("paused")).toBe("paused");
  });

  /** An unknown status must never grant access by default. */
  it("never maps an unknown status to active", () => {
    for (const s of ["incomplete", "something_new", "", "ACTIVE"]) {
      expect(mapStripeStatus(s)).not.toBe("active");
    }
  });
});

describe("subscriptionIdFromInvoice — the missed-payment bug", () => {
  it("reads the modern nested path", () => {
    expect(
      subscriptionIdFromInvoice({
        parent: { subscription_details: { subscription: "sub_modern" } },
      })
    ).toBe("sub_modern");
  });

  /**
   * THE ACTUAL BUG. The webhook endpoint was pinned to API version 2018-02-28,
   * which puts the subscription at the top level. Reading only the modern path
   * returned null, so no subscription was ever synced and a successful payment
   * never changed the customer's plan.
   */
  it("reads the legacy top-level field", () => {
    expect(subscriptionIdFromInvoice({ subscription: "sub_legacy" })).toBe("sub_legacy");
  });

  it("accepts an expanded object in either position", () => {
    expect(
      subscriptionIdFromInvoice({
        parent: { subscription_details: { subscription: { id: "sub_expanded" } } },
      })
    ).toBe("sub_expanded");
    expect(subscriptionIdFromInvoice({ subscription: { id: "sub_legacy_obj" } })).toBe(
      "sub_legacy_obj"
    );
  });

  it("prefers the modern path when both are present", () => {
    expect(
      subscriptionIdFromInvoice({
        parent: { subscription_details: { subscription: "sub_new" } },
        subscription: "sub_old",
      })
    ).toBe("sub_new");
  });

  it("returns null for a genuine one-off invoice", () => {
    expect(subscriptionIdFromInvoice({})).toBeNull();
    expect(subscriptionIdFromInvoice({ parent: null })).toBeNull();
    expect(subscriptionIdFromInvoice({ parent: { subscription_details: null } })).toBeNull();
    expect(
      subscriptionIdFromInvoice({ parent: { subscription_details: { subscription: null } } })
    ).toBeNull();
  });
});

describe("extractPeriod", () => {
  it("prefers the period on the subscription item", () => {
    expect(
      extractPeriod({
        items: { data: [{ current_period_start: 100, current_period_end: 200 }] },
      })
    ).toEqual({ start: 100, end: 200 });
  });

  /** Older payloads carry it on the subscription itself. */
  it("falls back to the subscription level", () => {
    expect(extractPeriod({ current_period_start: 300, current_period_end: 400 })).toEqual({
      start: 300, end: 400,
    });
  });

  it("prefers item values when both exist", () => {
    expect(
      extractPeriod({
        items: { data: [{ current_period_start: 100, current_period_end: 200 }] },
        current_period_start: 300, current_period_end: 400,
      })
    ).toEqual({ start: 100, end: 200 });
  });

  /**
   * Nulls matter: usage counters key to the billing period, so a missing period
   * silently sends metering to a calendar-month fallback instead of failing.
   */
  it("returns nulls when no period is present", () => {
    expect(extractPeriod({})).toEqual({ start: null, end: null });
    expect(extractPeriod({ items: { data: [] } })).toEqual({ start: null, end: null });
  });
});

describe("nextPastDueSince — dunning window", () => {
  const NOW = "2026-09-30T12:00:00.000Z";
  const EARLIER = "2026-09-25T12:00:00.000Z";

  it("stamps the first failure", () => {
    expect(nextPastDueSince({ stripeStatus: "past_due", existing: null, now: NOW })).toBe(NOW);
  });

  /** Re-stamping on every retry would push the deadline out forever. */
  it("keeps the original timestamp across retries", () => {
    expect(nextPastDueSince({ stripeStatus: "past_due", existing: EARLIER, now: NOW })).toBe(
      EARLIER
    );
  });

  it("treats unpaid the same as past_due", () => {
    expect(nextPastDueSince({ stripeStatus: "unpaid", existing: null, now: NOW })).toBe(NOW);
  });

  /**
   * Clearing on recovery is essential: otherwise a failure months later would
   * measure grace from the first-ever failure and deny access immediately.
   */
  it("clears on recovery", () => {
    expect(nextPastDueSince({ stripeStatus: "active", existing: EARLIER, now: NOW })).toBeNull();
    expect(nextPastDueSince({ stripeStatus: "trialing", existing: EARLIER, now: NOW })).toBeNull();
  });

  it("clears on cancellation", () => {
    expect(nextPastDueSince({ stripeStatus: "canceled", existing: EARLIER, now: NOW })).toBeNull();
  });
});

/**
 * The bug these cover: a scheduled downgrade stays `active` for the rest of the
 * paid period, so clearing pending state on "active" wiped the customer's
 * "Changing to X on <date>" notice seconds after they booked it.
 */
describe("shouldClearPendingChange", () => {
  const PRO = "plan_pro";
  const STARTER = "plan_starter";

  it("KEEPS a scheduled downgrade while it is still pending", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "active",
        hasSchedule: true,
        pendingPlanId: STARTER,
        currentPlanId: PRO,
      })
    ).toBe(false);
  });

  it("clears once Stripe bills the pending plan", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "active",
        hasSchedule: false,
        pendingPlanId: STARTER,
        currentPlanId: STARTER,
      })
    ).toBe(true);
  });

  // The schedule can linger for a moment after the phase transition.
  it("clears when billing the pending plan even if a schedule remains", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "active",
        hasSchedule: true,
        pendingPlanId: STARTER,
        currentPlanId: STARTER,
      })
    ).toBe(true);
  });

  // An upgrade releases the pending downgrade's schedule, so the old target
  // is genuinely stale.
  it("clears a stale pending target when no schedule remains", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "active",
        hasSchedule: false,
        pendingPlanId: STARTER,
        currentPlanId: PRO,
      })
    ).toBe(true);
  });

  it("does nothing when nothing is pending", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "active",
        hasSchedule: false,
        pendingPlanId: null,
        currentPlanId: PRO,
      })
    ).toBe(false);
  });

  // A failing payment must not discard the customer's recorded intent.
  it("keeps pending state while the subscription is unhealthy", () => {
    for (const s of ["past_due", "canceled", "incomplete", "paused", "unpaid"]) {
      expect(
        shouldClearPendingChange({
          stripeStatus: s,
          hasSchedule: true,
          pendingPlanId: STARTER,
          currentPlanId: PRO,
        })
      ).toBe(false);
    }
  });

  it("keeps a scheduled change through a trial", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "trialing",
        hasSchedule: true,
        pendingPlanId: STARTER,
        currentPlanId: PRO,
      })
    ).toBe(false);
  });

  // Our price table may not resolve a grandfathered price to a plan.
  it("keeps a scheduled change when the current plan cannot be resolved", () => {
    expect(
      shouldClearPendingChange({
        stripeStatus: "active",
        hasSchedule: true,
        pendingPlanId: STARTER,
        currentPlanId: null,
      })
    ).toBe(false);
  });
});

describe("shouldClearPending / shouldClearComp", () => {
  it("clears a pending change once the subscription is healthy", () => {
    expect(shouldClearPending("active")).toBe(true);
    expect(shouldClearPending("trialing")).toBe(true);
  });

  it("keeps a pending change while the subscription is not healthy", () => {
    for (const s of ["past_due", "canceled", "incomplete", "paused"]) {
      expect(shouldClearPending(s)).toBe(false);
    }
  });

  /** A paying customer must stop showing as complimentary access. */
  it("clears a comp when a real subscription becomes active", () => {
    expect(shouldClearComp("active")).toBe(true);
    expect(shouldClearComp("trialing")).toBe(true);
  });

  it("leaves a comp intact when the subscription is not active", () => {
    expect(shouldClearComp("incomplete")).toBe(false);
    expect(shouldClearComp("canceled")).toBe(false);
  });
});

describe("interpretClaim — idempotency", () => {
  it("processes a first delivery", () => {
    expect(interpretClaim(null)).toBe("process");
    expect(interpretClaim(undefined)).toBe("process");
  });

  /** Without this, a retried invoice.paid would double-extend the period. */
  it("treats a unique violation as an already-handled duplicate", () => {
    expect(interpretClaim("23505")).toBe("duplicate");
  });

  it("treats any other error as a storage failure so Stripe retries", () => {
    expect(interpretClaim("42501")).toBe("storage_error");
    expect(interpretClaim("08006")).toBe("storage_error");
  });
});

describe("webhookResponseStatus", () => {
  /** An untrusted payload must not be retried. */
  it("rejects signature problems with 400", () => {
    expect(webhookResponseStatus("invalid_signature")).toBe(400);
    expect(webhookResponseStatus("no_signature")).toBe(400);
  });

  /** Nothing was processed, so Stripe SHOULD try again. */
  it("asks for a retry with 500 when the claim itself failed", () => {
    expect(webhookResponseStatus("claim_failed")).toBe(500);
  });

  /**
   * A handler bug is not fixed by retrying, and an endlessly retried event
   * buries genuine ones — so it is acknowledged and recorded as failed.
   */
  it("acknowledges a handler failure with 200", () => {
    expect(webhookResponseStatus("handler_failed")).toBe(200);
  });

  it("acknowledges success, duplicates and ignored events", () => {
    expect(webhookResponseStatus("ok")).toBe(200);
    expect(webhookResponseStatus("duplicate")).toBe(200);
    expect(webhookResponseStatus("ignored")).toBe(200);
  });
});

describe("isEnding — the 'still shows Renews after cancelling' bug", () => {
  it("detects the flag set by our own update call", () => {
    expect(isEnding({ cancel_at_period_end: true })).toBe(true);
  });

  /**
   * THE ACTUAL BUG. Stripe's billing portal cancels by setting a dated
   * `cancel_at` rather than the boolean flag. Reading only the flag meant a
   * cancelled subscription still displayed "Renews <date>" to the customer AND in
   * the admin table.
   */
  it("detects a dated cancellation from the billing portal", () => {
    expect(isEnding({ cancel_at: 1822311562 })).toBe(true);
  });

  it("treats a renewing subscription as not ending", () => {
    expect(isEnding({ cancel_at_period_end: false, cancel_at: null })).toBe(false);
    expect(isEnding({})).toBe(false);
  });

  it("ignores a zero or negative cancel_at", () => {
    expect(isEnding({ cancel_at: 0 })).toBe(false);
    expect(isEnding({ cancel_at: -1 })).toBe(false);
  });
});

describe("accessEndsAt", () => {
  it("prefers an explicit cancel_at over the period end", () => {
    expect(accessEndsAt({ cancel_at: 1000, current_period_end: 2000 })).toBe(1000);
  });

  it("falls back to the period end", () => {
    expect(accessEndsAt({ current_period_end: 2000 })).toBe(2000);
  });

  it("returns null when neither is known", () => {
    expect(accessEndsAt({})).toBeNull();
    expect(accessEndsAt({ cancel_at: 0, current_period_end: 0 })).toBeNull();
  });
});
