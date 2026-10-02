import { describe, it, expect } from "vitest";
import {
  canStartCheckout,
  scheduleActionFor,
  findCurrentPhase,
  describePlanChange,
  isLiveSubscription,
} from "./plan-change";

/**
 * These tests encode the three bugs that reached production, so a regression
 * fails here rather than on a customer's card.
 */

describe("isLiveSubscription", () => {
  it("counts active, trialing, past_due and unpaid as live", () => {
    for (const s of ["active", "trialing", "past_due", "unpaid"]) {
      expect(isLiveSubscription(s)).toBe(true);
    }
  });

  it("does not count terminal or unstarted states", () => {
    for (const s of ["canceled", "incomplete", "incomplete_expired", "paused", null, ""]) {
      expect(isLiveSubscription(s)).toBe(false);
    }
  });
});

describe("canStartCheckout — the double-payment bug", () => {
  const base = { dbStatus: null, dbHasSubscriptionId: false, dbModeMatches: true, stripeStatuses: [] };

  it("allows a first purchase", () => {
    expect(canStartCheckout(base).allowed).toBe(true);
  });

  it("refuses when our own row shows a live subscription", () => {
    const d = canStartCheckout({
      ...base, dbStatus: "active", dbHasSubscriptionId: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("already_subscribed_db");
  });

  /**
   * THE ACTUAL BUG. A missed webhook left our row empty while Stripe had an
   * active subscription, so a second checkout looked legitimate and the customer
   * was charged twice — two live subscriptions on one customer.
   */
  it("refuses when Stripe has a live subscription even though our row does not", () => {
    const d = canStartCheckout({ ...base, stripeStatuses: ["active"] });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("already_subscribed_stripe");
  });

  it("refuses on a trialing or past_due Stripe subscription too", () => {
    expect(canStartCheckout({ ...base, stripeStatuses: ["trialing"] }).allowed).toBe(false);
    expect(canStartCheckout({ ...base, stripeStatuses: ["past_due"] }).allowed).toBe(false);
  });

  it("allows when Stripe only has terminal subscriptions", () => {
    const d = canStartCheckout({ ...base, stripeStatuses: ["canceled", "incomplete_expired"] });
    expect(d.allowed).toBe(true);
  });

  /** A test-mode id is meaningless in live mode, so it must not block a purchase. */
  it("ignores our row when it belongs to the other Stripe mode", () => {
    const d = canStartCheckout({
      ...base, dbStatus: "active", dbHasSubscriptionId: true, dbModeMatches: false,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("scheduleActionFor — the downgrade and revert bugs", () => {
  /**
   * BUG: creating a second schedule fails with "You cannot migrate a subscription
   * that is already attached to a schedule", so revising a pending downgrade was
   * impossible.
   */
  it("reuses an existing active schedule for a downgrade", () => {
    expect(
      scheduleActionFor({ timing: "period_end", hasSchedule: true, scheduleStatus: "active" })
    ).toBe("reuse");
  });

  it("creates a schedule for a first downgrade", () => {
    expect(scheduleActionFor({ timing: "period_end", hasSchedule: false })).toBe("create");
  });

  it("creates a fresh schedule when the existing one is no longer editable", () => {
    expect(
      scheduleActionFor({ timing: "period_end", hasSchedule: true, scheduleStatus: "released" })
    ).toBe("create");
    expect(
      scheduleActionFor({ timing: "period_end", hasSchedule: true, scheduleStatus: "canceled" })
    ).toBe("create");
  });

  /**
   * BUG: an upgrade applied while a downgrade schedule was attached got silently
   * reverted at period end — the customer paid for a tier they would lose.
   */
  it("releases a pending schedule before an immediate upgrade", () => {
    expect(scheduleActionFor({ timing: "immediate", hasSchedule: true })).toBe("release");
  });

  it("does nothing for an upgrade with no schedule attached", () => {
    expect(scheduleActionFor({ timing: "immediate", hasSchedule: false })).toBe("none");
  });

  it("does nothing when there is no change", () => {
    expect(scheduleActionFor({ timing: "none", hasSchedule: true })).toBe("none");
  });
});

describe("findCurrentPhase", () => {
  const NOW = 1_800_000_000;

  it("finds the phase containing now", () => {
    const phases = [
      { start_date: NOW - 1000, end_date: NOW + 1000, id: "current" },
      { start_date: NOW + 1000, end_date: null, id: "next" },
    ];
    expect(findCurrentPhase(phases, NOW)?.id).toBe("current");
  });

  /** Rewriting from an elapsed phase produces a schedule Stripe rejects. */
  it("skips a phase that has already ended", () => {
    const phases = [
      { start_date: NOW - 5000, end_date: NOW - 4000, id: "old" },
      { start_date: NOW - 100, end_date: NOW + 900, id: "current" },
    ];
    expect(findCurrentPhase(phases, NOW)?.id).toBe("current");
  });

  it("treats an open-ended phase as current", () => {
    const phases = [{ start_date: NOW - 10, end_date: null, id: "open" }];
    expect(findCurrentPhase(phases, NOW)?.id).toBe("open");
  });

  it("falls back to the last phase when none contains now", () => {
    const phases = [
      { start_date: NOW + 1000, end_date: NOW + 2000, id: "a" },
      { start_date: NOW + 2000, end_date: NOW + 3000, id: "b" },
    ];
    expect(findCurrentPhase(phases, NOW)?.id).toBe("b");
  });

  it("returns null for no phases", () => {
    expect(findCurrentPhase([], NOW)).toBeNull();
  });
});

/**
 * This copy is the only warning a customer gets before an immediate charge, so
 * the cases are asserted rather than eyeballed. Showing downgrade wording for an
 * upgrade would be worse than showing nothing.
 */
describe("describePlanChange", () => {
  const base = {
    currentPlanName: "Starter",
    targetPlanName: "Pro",
    targetCycle: "monthly" as const,
    targetAmountMinor: 14900,
    periodEnd: "2026-11-01T00:00:00.000Z",
  };

  it("warns that an upgrade charges the card today", () => {
    const p = describePlanChange({ ...base, kind: "upgrade" });
    expect(p.chargesNow).toBe(true);
    expect(p.tone).toBe("warn");
    expect(p.title).toContain("Pro");
    expect(p.body).toMatch(/charged today/i);
    expect(p.confirmLabel).toMatch(/pay now/i);
  });

  it("states the ongoing upgrade price and that the charge is prorated", () => {
    const p = describePlanChange({ ...base, kind: "upgrade" });
    expect(p.body).toContain("$149");
    expect(p.body).toMatch(/per month/);
    expect(p.body).toMatch(/difference/i);
  });

  it("makes clear a downgrade costs nothing today", () => {
    const p = describePlanChange({
      ...base,
      kind: "downgrade",
      currentPlanName: "Pro",
      targetPlanName: "Starter",
      targetAmountMinor: 4900,
    });
    expect(p.chargesNow).toBe(false);
    expect(p.tone).toBe("info");
    expect(p.body).toMatch(/No charge today/i);
    expect(p.confirmLabel).toMatch(/schedule/i);
  });

  it("names the date a downgrade takes effect", () => {
    const p = describePlanChange({
      ...base,
      kind: "downgrade",
      currentPlanName: "Pro",
      targetPlanName: "Starter",
    });
    // Rendered as a readable date, not an ISO string.
    expect(p.body).toMatch(/Nov 1, 2026/);
    expect(p.body).toContain("Pro");
  });

  it("falls back to generic wording when no period end is known", () => {
    const p = describePlanChange({
      ...base,
      kind: "downgrade",
      currentPlanName: "Pro",
      targetPlanName: "Starter",
      periodEnd: null,
    });
    expect(p.body).toMatch(/end of your current period/i);
    expect(p.body).not.toMatch(/Invalid Date/);
  });

  it("treats a cycle change as charging now", () => {
    const p = describePlanChange({
      ...base,
      kind: "cycle_change",
      targetCycle: "annual",
      targetAmountMinor: 149000,
    });
    expect(p.chargesNow).toBe(true);
    expect(p.title).toMatch(/annual/i);
    expect(p.body).toMatch(/credited/i);
  });

  it("uses per-year wording for an annual target", () => {
    const p = describePlanChange({
      ...base,
      kind: "upgrade",
      targetCycle: "annual",
      targetAmountMinor: 149000,
    });
    expect(p.body).toMatch(/per year/);
  });

  // A missing price must not render "$NaN" or "$undefined" next to a charge.
  it("omits the amount gracefully when it is unknown", () => {
    const p = describePlanChange({ ...base, kind: "upgrade", targetAmountMinor: null });
    expect(p.body).not.toMatch(/NaN|undefined|\$\s/);
    expect(p.body).toMatch(/Pro rate/);
  });

  it("describes no-op changes without alarming wording", () => {
    const p = describePlanChange({ ...base, kind: "same" });
    expect(p.chargesNow).toBe(false);
    expect(p.title).toMatch(/no change/i);
  });
});
