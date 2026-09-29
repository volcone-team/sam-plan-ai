import { describe, it, expect } from "vitest";
import {
  evaluateAccess,
  type BillingSettings,
  type SubscriptionState,
} from "./entitlement";
import {
  checkLimit,
  resolveUsagePeriod,
  classifyPlanChange,
  changeTiming,
  UNLIMITED,
} from "./limits";

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const ON: BillingSettings = {
  stripeEnabled: true,
  trialEnabled: true,
  trialDays: 14,
  dunningGraceDays: 7,
};
const OFF: BillingSettings = { ...ON, stripeEnabled: false };

function sub(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: "active",
    isComped: false,
    compedUntil: null,
    trialEndsAt: null,
    currentPeriodEnd: new Date(NOW + 20 * DAY).toISOString(),
    pastDueSince: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("evaluateAccess — master switch", () => {
  /** The whole point of the toggle: off means the app behaves as it did pre-Stripe. */
  it("grants access to everyone when billing is disabled", () => {
    const d = evaluateAccess(OFF, null, NOW);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("billing_disabled");
  });

  it("grants access when disabled even if the subscription is canceled", () => {
    expect(evaluateAccess(OFF, sub({ status: "canceled" }), NOW).allowed).toBe(true);
  });

  it("denies a missing subscription once billing is enabled", () => {
    const d = evaluateAccess(ON, null, NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no_subscription");
  });
});

describe("evaluateAccess — comped", () => {
  it("grants indefinite access when comped with no expiry", () => {
    const d = evaluateAccess(ON, sub({ isComped: true, status: null }), NOW);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("comped");
    expect(d.daysRemaining).toBeNull();
  });

  it("grants access while a dated comp is still valid", () => {
    const d = evaluateAccess(
      ON,
      sub({ isComped: true, status: null, compedUntil: new Date(NOW + 30 * DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
    expect(d.daysRemaining).toBe(30);
    expect(d.warn).toBe(false);
  });

  it("warns in the final week of a comp", () => {
    const d = evaluateAccess(
      ON,
      sub({ isComped: true, status: null, compedUntil: new Date(NOW + 3 * DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
    expect(d.warn).toBe(true);
  });

  it("denies once a comp has lapsed with no real subscription", () => {
    const d = evaluateAccess(
      ON,
      sub({ isComped: true, status: null, compedUntil: new Date(NOW - DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("comp_expired");
  });

  /** A lapsed comp must not override a subscription they since paid for. */
  it("falls through to an active subscription when the comp has lapsed", () => {
    const d = evaluateAccess(
      ON,
      sub({ isComped: true, status: "active", compedUntil: new Date(NOW - DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("active");
  });
});

describe("evaluateAccess — trial", () => {
  it("grants access during a trial", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "trialing", trialEndsAt: new Date(NOW + 10 * DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
    expect(d.daysRemaining).toBe(10);
  });

  it("warns in the last three days", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "trialing", trialEndsAt: new Date(NOW + 2 * DAY).toISOString() }),
      NOW
    );
    expect(d.warn).toBe(true);
  });

  it("denies an expired trial", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "trialing", trialEndsAt: new Date(NOW - DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("trial_expired");
  });

  /** Pre-Stripe rows use the local 'trial' status rather than Stripe's 'trialing'. */
  it("honours the legacy 'trial' status", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "trial", trialEndsAt: new Date(NOW + 5 * DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("trialing");
  });

  /** Missing data is operator error; it must not look like non-payment. */
  it("does not lock out a trial with no end date", () => {
    const d = evaluateAccess(ON, sub({ status: "trialing", trialEndsAt: null }), NOW);
    expect(d.allowed).toBe(true);
  });
});

describe("evaluateAccess — dunning", () => {
  it("keeps access inside the grace window", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "past_due", pastDueSince: new Date(NOW - 2 * DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("grace_period");
    expect(d.warn).toBe(true);
    expect(d.daysRemaining).toBe(5);
  });

  it("denies once the grace window closes", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "past_due", pastDueSince: new Date(NOW - 10 * DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("past_due_expired");
  });

  it("treats 'unpaid' like 'past_due'", () => {
    const d = evaluateAccess(
      ON,
      sub({ status: "unpaid", pastDueSince: new Date(NOW - DAY).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(true);
  });

  it("respects a zero-day grace setting", () => {
    const d = evaluateAccess(
      { ...ON, dunningGraceDays: 0 },
      sub({ status: "past_due", pastDueSince: new Date(NOW - 60_000).toISOString() }),
      NOW
    );
    expect(d.allowed).toBe(false);
  });
});

describe("evaluateAccess — active and terminal states", () => {
  it("warns when a subscription is set to cancel at period end", () => {
    const d = evaluateAccess(ON, sub({ cancelAtPeriodEnd: true }), NOW);
    expect(d.allowed).toBe(true);
    expect(d.warn).toBe(true);
  });

  it("denies canceled and paused", () => {
    expect(evaluateAccess(ON, sub({ status: "canceled" }), NOW).allowed).toBe(false);
    expect(evaluateAccess(ON, sub({ status: "paused" }), NOW).allowed).toBe(false);
  });

  it("denies an unfinished checkout", () => {
    const d = evaluateAccess(ON, sub({ status: "incomplete" }), NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("incomplete");
  });
});

describe("checkLimit", () => {
  it("allows under a cap and reports what is left", () => {
    const c = checkLimit(20, 5);
    expect(c.allowed).toBe(true);
    expect(c.remaining).toBe(15);
  });

  it("denies at the cap", () => {
    expect(checkLimit(5, 5).allowed).toBe(false);
  });

  it("treats -1 as unlimited", () => {
    const c = checkLimit(UNLIMITED, 9999);
    expect(c.allowed).toBe(true);
    expect(c.unlimited).toBe(true);
  });

  it("treats 0 as not included in the plan", () => {
    const c = checkLimit(0, 0);
    expect(c.allowed).toBe(false);
    expect(c.notIncluded).toBe(true);
  });

  /** Failing open on missing config beats breaking the app for everyone. */
  it("treats a missing limit as unlimited", () => {
    expect(checkLimit(null, 100).allowed).toBe(true);
    expect(checkLimit(undefined, 100).allowed).toBe(true);
  });

  it("accounts for a multi-unit request", () => {
    expect(checkLimit(10, 8, 3).allowed).toBe(false);
    expect(checkLimit(10, 7, 3).allowed).toBe(true);
  });

  /**
   * The mid-cycle upgrade case: the cap rises, usage stands. Five already spent
   * against Starter leaves 15 of Pro's 20, not a fresh 20.
   */
  it("raises the ceiling on upgrade without forgiving usage", () => {
    expect(checkLimit(5, 5).allowed).toBe(false);
    const afterUpgrade = checkLimit(20, 5);
    expect(afterUpgrade.allowed).toBe(true);
    expect(afterUpgrade.remaining).toBe(15);
  });

  it("clamps malformed usage", () => {
    expect(checkLimit(10, -5).used).toBe(0);
    expect(checkLimit(10, NaN).used).toBe(0);
  });
});

describe("resolveUsagePeriod", () => {
  it("uses the Stripe period when it contains now", () => {
    const start = new Date(NOW - 5 * DAY).toISOString();
    const end = new Date(NOW + 25 * DAY).toISOString();
    expect(resolveUsagePeriod(start, end, NOW)).toEqual({ periodStart: start, periodEnd: end });
  });

  it("falls back to a calendar month with no subscription period", () => {
    const p = resolveUsagePeriod(null, null, NOW);
    expect(p.periodStart).toBe("2026-09-01T00:00:00.000Z");
    expect(p.periodEnd).toBe("2026-10-01T00:00:00.000Z");
  });

  /** A stale window would key usage to a period that never resets. */
  it("ignores a period that has already ended", () => {
    const p = resolveUsagePeriod(
      new Date(NOW - 60 * DAY).toISOString(),
      new Date(NOW - 30 * DAY).toISOString(),
      NOW
    );
    expect(p.periodStart).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("classifyPlanChange / changeTiming", () => {
  const starter = { planId: "s", cycle: "monthly", price: 49 };
  const pro = { planId: "p", cycle: "monthly", price: 149 };

  it("classifies upgrades and downgrades by price", () => {
    expect(classifyPlanChange(starter, pro)).toBe("upgrade");
    expect(classifyPlanChange(pro, starter)).toBe("downgrade");
  });

  it("detects no change", () => {
    expect(classifyPlanChange(starter, starter)).toBe("same");
  });

  it("treats a cycle switch separately from a tier change", () => {
    expect(
      classifyPlanChange(starter, { planId: "s", cycle: "annual", price: 490 })
    ).toBe("cycle_change");
  });

  it("applies upgrades now and downgrades at period end", () => {
    expect(changeTiming("upgrade")).toBe("immediate");
    expect(changeTiming("cycle_change")).toBe("immediate");
    expect(changeTiming("downgrade")).toBe("period_end");
    expect(changeTiming("same")).toBe("none");
  });
});
