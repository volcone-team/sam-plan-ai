/**
 * Property 6: Preservation (Unit C, billing after grant then revoke)
 * Entitlement, comp, Checkout and change-plan rules unchanged for every other
 * state.
 *
 * Written BEFORE the fix (task 19.2) and run on unfixed code, where it must
 * pass. Decisions go through `*UnderTest` functions: before the fix they were
 * verbatim copies of today's inline logic; task 19.5 pointed them at the new
 * helpers and re-ran this SAME file, which must still pass.
 *
 * Inputs are produced by seeded generator loops (no fast-check). Each section
 * filters OUT the bug condition (isBugCondition_C and its paused / spelling
 * variants), because only there may behaviour change.
 *
 * **Validates: Requirements 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17**
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateAccess,
  type AccessDecision,
  type BillingSettings,
  type SubscriptionState,
} from "../entitlement";
import { requiresPurchase, isAllowedWhileLockedOut } from "../lockout";
import { canStartCheckout, isLiveSubscription } from "../plan-change";
import { classifyPlanChange, changeTiming } from "../limits";
import { mapStripeStatus, shouldClearComp } from "../webhook-logic";
import { changePlanGuard } from "../live-subscription";
import { decideBillingGate, type GateSubRow } from "../billing-gate";
import { shouldClearPauseOnSync } from "../webhook-logic";

/* ------------------------------ generators ------------------------------- */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Every status the columns can hold, minus the British 'cancelled' (bug c). */
const STATUSES = [
  "trialing", "active", "past_due", "canceled", "unpaid", "incomplete",
  "incomplete_expired", "paused", "trial", null,
] as const;

const DATES = [null, iso(NOW - 30 * DAY), iso(NOW - DAY), iso(NOW + DAY), iso(NOW + 30 * DAY), "not-a-date"];

const PATHS = [
  "/year-at-a-glance", "/settings", "/planner", "/choose-plan", "/checkout", "/welcome",
  "/account-paused", "/api/me", "/api/me/password", "/api/auth/2fa", "/api/plan/year",
  "/api/stripe/checkout", "/api/stripe/change-plan", "/api/stripe/portal",
  "/api/billing/me", "/api/billing/reconcile", "/api/billing/cancel", "/api/billing/resume",
] as const;

function genRow(r: () => number): GateSubRow {
  return {
    is_paused: pick(r, [false, true, null]),
    pause_resumes_at: pick(r, DATES),
    status: pick(r, STATUSES),
    stripe_status: pick(r, STATUSES),
    is_comped: pick(r, [false, true, null]),
    comped_until: pick(r, DATES),
    trial_ends_at: pick(r, DATES),
    current_period_end: pick(r, DATES),
    past_due_since: pick(r, DATES),
    cancel_at_period_end: pick(r, [false, true, null]),
    stripe_subscription_id: pick(r, [null, "sub_test_abc123"]),
    stripe_mode: pick(r, [null, "live", "test"]),
  };
}

function genSettings(r: () => number): BillingSettings {
  return {
    stripeEnabled: r() < 0.85,
    trialEnabled: r() < 0.5,
    trialDays: 14,
    dunningGraceDays: pick(r, [0, 3, 7]),
  };
}

/** Independent statement of "a live Stripe subscription in this mode". */
const LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);
function independentlyLive(row: GateSubRow): boolean {
  const s = row.stripe_status ?? row.status;
  return !!row.stripe_subscription_id && row.stripe_mode === "live" && !!s && LIVE.has(s);
}

/** Paths a paused account with no live sub may now reach (the approved change). */
const PAUSED_PURCHASE_PATHS = [
  "/choose-plan", "/checkout", "/welcome", "/api/stripe/checkout",
  "/api/billing/me", "/api/billing/reconcile", "/api/me", "/api/auth",
];
function inPausedPurchaseDomain(row: GateSubRow, path: string): boolean {
  return (
    !!row.is_paused &&
    !row.is_comped &&
    !independentlyLive(row) &&
    PAUSED_PURCHASE_PATHS.some((p) => path === p || path.startsWith(p + "/"))
  );
}

/* --------------------- oracle: evaluateAccess, verbatim -------------------- */
// Copy of src/lib/billing/entitlement.ts evaluateAccess as it was before the
// fix. The fix only adds the 'cancelled' → 'canceled' normalisation, so for
// every other status the real function must agree with this exactly.

function oracleEvaluateAccess(
  settings: BillingSettings,
  sub: SubscriptionState | null,
  now: number
): AccessDecision {
  const parseTime = (v: string | null) => {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const daysBetween = (a: number, b: number) => Math.ceil((b - a) / DAY);

  if (!settings.stripeEnabled) {
    return { allowed: true, reason: "billing_disabled", warn: false, daysRemaining: null };
  }
  if (!sub) return { allowed: false, reason: "no_subscription", warn: false, daysRemaining: null };
  if (sub.isPaused) {
    const resumes = parseTime(sub.pauseResumesAt ?? null);
    const pauseElapsed = resumes !== null && resumes <= now;
    if (!pauseElapsed) {
      return {
        allowed: false,
        reason: "paused",
        warn: false,
        daysRemaining: resumes !== null && resumes > now ? daysBetween(now, resumes) : null,
      };
    }
  }
  if (sub.isComped) {
    const until = parseTime(sub.compedUntil);
    if (until === null) return { allowed: true, reason: "comped", warn: false, daysRemaining: null };
    if (until > now) {
      const left = daysBetween(now, until);
      return { allowed: true, reason: "comped", warn: left <= 7, daysRemaining: left };
    }
    if (sub.status !== "active" && sub.status !== "trialing") {
      return { allowed: false, reason: "comp_expired", warn: false, daysRemaining: 0 };
    }
  }
  if (sub.status === "trialing" || sub.status === "trial") {
    const ends = parseTime(sub.trialEndsAt);
    if (ends === null) return { allowed: true, reason: "trialing", warn: false, daysRemaining: null };
    if (ends > now) {
      const left = daysBetween(now, ends);
      return { allowed: true, reason: "trialing", warn: left <= 3, daysRemaining: left };
    }
    return { allowed: false, reason: "trial_expired", warn: false, daysRemaining: 0 };
  }
  if (sub.status === "active") {
    const periodEnd = parseTime(sub.currentPeriodEnd);
    const left = periodEnd ? daysBetween(now, periodEnd) : null;
    return { allowed: true, reason: "active", warn: sub.cancelAtPeriodEnd, daysRemaining: left };
  }
  if (sub.status === "past_due" || sub.status === "unpaid") {
    const since = parseTime(sub.pastDueSince);
    if (since === null) {
      return { allowed: true, reason: "grace_period", warn: true, daysRemaining: settings.dunningGraceDays };
    }
    const graceEnds = since + settings.dunningGraceDays * DAY;
    if (graceEnds > now) {
      return { allowed: true, reason: "grace_period", warn: true, daysRemaining: daysBetween(now, graceEnds) };
    }
    return { allowed: false, reason: "past_due_expired", warn: false, daysRemaining: 0 };
  }
  if (sub.status === "canceled" || sub.status === "paused") {
    return { allowed: false, reason: "canceled", warn: false, daysRemaining: null };
  }
  return { allowed: false, reason: "incomplete", warn: false, daysRemaining: null };
}

function toState(row: GateSubRow, isPaused: boolean): SubscriptionState {
  return {
    status: (row.stripe_status ?? row.status ?? null) as never,
    isComped: row.is_comped ?? false,
    compedUntil: row.comped_until ?? null,
    trialEndsAt: row.trial_ends_at ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    pastDueSince: row.past_due_since ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
    isPaused,
    pauseResumesAt: row.pause_resumes_at,
  };
}

/* ------------------------- computeUnderTest bodies ------------------------- */

function gateUnderTest(args: {
  isAdmin: boolean;
  row: GateSubRow | null;
  pathname: string;
  settings: BillingSettings;
}): "pass" | "paused" | "purchase" {
  return decideBillingGate({
    isAdmin: args.isAdmin,
    hasCompany: true,
    sub: args.row,
    settings: args.settings,
    pathname: args.pathname,
    now: NOW,
  }).kind;
}

/** Verbatim copy of the middleware gate before the fix: the oracle. */
function gateOriginal(args: {
  isAdmin: boolean;
  row: GateSubRow | null;
  pathname: string;
  settings: BillingSettings;
}): "pass" | "paused" | "purchase" {
  if (args.isAdmin) return "pass";
  const gateSub = args.row;
  if (gateSub?.is_paused) return "paused";
  const access = oracleEvaluateAccess(
    args.settings,
    {
      status: (gateSub?.stripe_status ?? gateSub?.status ?? null) as never,
      isComped: gateSub?.is_comped ?? false,
      compedUntil: gateSub?.comped_until ?? null,
      trialEndsAt: gateSub?.trial_ends_at ?? null,
      currentPeriodEnd: gateSub?.current_period_end ?? null,
      pastDueSince: gateSub?.past_due_since ?? null,
      cancelAtPeriodEnd: gateSub?.cancel_at_period_end ?? false,
      isPaused: false,
    },
    NOW
  );
  if (!access.allowed && requiresPurchase(access.reason) && !isAllowedWhileLockedOut(args.pathname)) {
    return "purchase";
  }
  return "pass";
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

const ITER = 600;

describe("Property 6: preservation for every state outside the bug condition", () => {
  it("evaluateAccess precedence matches the original for every non-'cancelled' state", () => {
    const r = rng(6001);
    for (let i = 0; i < ITER * 2; i++) {
      const row = genRow(r);
      const settings = genSettings(r);
      const paused = !!row.is_paused;
      const state = r() < 0.05 ? null : toState(row, paused);
      expect(evaluateAccess(settings, state, NOW), JSON.stringify({ settings, state })).toEqual(
        oracleEvaluateAccess(settings, state, NOW)
      );
    }
  });

  it("precedence spot checks: billing off > paused > comp > trial > active > grace", () => {
    const base = toState(
      { ...genRow(rng(1)), stripe_status: "active", status: "active" },
      true
    );
    const on: BillingSettings = { stripeEnabled: true, trialEnabled: false, trialDays: 14, dunningGraceDays: 7 };
    const paused = { ...base, isPaused: true, pauseResumesAt: null, isComped: true, compedUntil: null };
    expect(evaluateAccess({ ...on, stripeEnabled: false }, paused, NOW).reason).toBe("billing_disabled");
    expect(evaluateAccess(on, paused, NOW).reason).toBe("paused");
    expect(evaluateAccess(on, { ...paused, isPaused: false, status: "trialing" }, NOW).reason).toBe("comped");
    expect(
      evaluateAccess(on, { ...paused, isPaused: false, isComped: false, status: "trialing", trialEndsAt: null }, NOW).reason
    ).toBe("trialing");
    expect(evaluateAccess(on, { ...paused, isPaused: false, isComped: false, status: "active" }, NOW).reason).toBe("active");
    expect(
      evaluateAccess(on, { ...paused, isPaused: false, isComped: false, status: "past_due", pastDueSince: null }, NOW).reason
    ).toBe("grace_period");
  });

  it("middleware gate unchanged outside the paused-purchase domain (incl. paused + live sub)", () => {
    const r = rng(6002);
    let checked = 0;
    for (let i = 0; i < ITER * 3; i++) {
      const row = genRow(r);
      const settings = genSettings(r);
      const pathname = pick(r, PATHS);
      const isAdmin = r() < 0.15;
      if (!isAdmin && inPausedPurchaseDomain(row, pathname)) continue;
      const args = { isAdmin, row, pathname, settings };
      expect(gateUnderTest(args), JSON.stringify(args)).toBe(gateOriginal(args));
      checked++;
    }
    expect(checked).toBeGreaterThan(ITER);
  });

  it("paused + live sub (or comped) is always sent to /account-paused for a non-admin", () => {
    const r = rng(6003);
    for (let i = 0; i < ITER; i++) {
      const row: GateSubRow = {
        ...genRow(r),
        is_paused: true,
        stripe_subscription_id: "sub_test_abc123",
        stripe_mode: "live",
        stripe_status: pick(r, ["active", "trialing", "past_due", "unpaid"]),
      };
      if (r() < 0.3) row.is_comped = true;
      const settings = { ...genSettings(r), stripeEnabled: true };
      for (const pathname of PATHS) {
        expect(gateUnderTest({ isAdmin: false, row, pathname, settings }), pathname).toBe("paused");
      }
    }
  });

  it("super admins are never gated", () => {
    const r = rng(6004);
    for (let i = 0; i < ITER; i++) {
      const row = genRow(r);
      const settings = genSettings(r);
      expect(gateUnderTest({ isAdmin: true, row, pathname: pick(r, PATHS), settings })).toBe("pass");
    }
  });

  it("/api/me stays an EXACT match; /api/me/password stays blocked", () => {
    expect(isAllowedWhileLockedOut("/api/me")).toBe(true);
    expect(isAllowedWhileLockedOut("/api/me/password")).toBe(false);
    const canceled: GateSubRow = {
      ...genRow(rng(2)),
      is_paused: false,
      is_comped: false,
      status: "canceled",
      stripe_status: "canceled",
    };
    const on: BillingSettings = { stripeEnabled: true, trialEnabled: false, trialDays: 14, dunningGraceDays: 7 };
    expect(gateUnderTest({ isAdmin: false, row: canceled, pathname: "/api/me", settings: on })).toBe("pass");
    expect(gateUnderTest({ isAdmin: false, row: canceled, pathname: "/api/me/password", settings: on })).toBe("purchase");
    // Paused with no live sub: /api/me/password is still blocked.
    const paused = { ...canceled, is_paused: true };
    expect(gateUnderTest({ isAdmin: false, row: paused, pathname: "/api/me/password", settings: on })).toBe("paused");
  });

  it("comp guard: refuses exactly when a paid sub is live (route source unchanged)", () => {
    // The guard lives in the shared comp helper (used by the subscribers route
    // and the admin create route); the route must still go through it.
    const route = readFileSync(resolve(__dirname, "../../../app/api/admin/subscribers/route.ts"), "utf8");
    expect(route).toContain("applyComp(db, {");
    const src = readFileSync(resolve(__dirname, "../comp.ts"), "utf8");
    expect(src).toContain('["active", "trialing", "past_due"].includes(existing.stripe_status ?? "")');
    expect(src).toContain('error: "has_paid_subscription"');
  });

  it("Checkout double-billing guards: DB guard and Stripe guard unchanged", () => {
    const src = readFileSync(resolve(__dirname, "../../../app/api/stripe/checkout/route.ts"), "utf8");
    expect(src).toContain('["active", "trialing", "past_due"].includes(subscription.stripe_status ?? "")');
    expect(src).toContain("live.data.find((sub) => isLiveSubscription(sub.status))");
    expect(src).not.toContain("is_paused");

    const r = rng(6005);
    for (let i = 0; i < ITER; i++) {
      const dbStatus = pick(r, STATUSES);
      const dbHasSubscriptionId = r() < 0.6;
      const dbModeMatches = r() < 0.8;
      const stripeStatuses = Array.from({ length: Math.floor(r() * 3) }, () => pick(r, STATUSES));
      const expected =
        (dbHasSubscriptionId && dbModeMatches && isLiveSubscription(dbStatus)) ||
        stripeStatuses.some((s) => isLiveSubscription(s));
      expect(
        canStartCheckout({ dbStatus, dbHasSubscriptionId, dbModeMatches, stripeStatuses }).allowed
      ).toBe(!expected);
    }
  });

  it("change-plan guards and classification unchanged for LIVE subscriptions", () => {
    const r = rng(6006);
    for (let i = 0; i < ITER; i++) {
      const row: GateSubRow = { ...genRow(r), is_paused: false };
      let expected: GuardResult;
      if (row.is_comped) expected = { ok: false, status: 400, error: "comped_account" };
      else if (!row.stripe_subscription_id || row.stripe_mode !== "live") {
        expected = { ok: false, status: 404, error: "no_subscription" };
      } else if (independentlyLive(row)) expected = { ok: true };
      else continue; // non-live with an id: the bug domain
      expect(changePlanGuardUnderTest(row), JSON.stringify(row)).toEqual(expected);
    }

    for (let i = 0; i < ITER; i++) {
      const plans = ["p1", "p2", "p3"];
      const cur = { planId: pick(r, plans), cycle: pick(r, ["monthly", "annual"]), price: Math.floor(r() * 5) * 1000 };
      const tgt = { planId: pick(r, plans), cycle: pick(r, ["monthly", "annual"]), price: Math.floor(r() * 5) * 1000 };
      const kind = classifyPlanChange(cur, tgt);
      const expectedKind =
        cur.planId === tgt.planId
          ? cur.cycle === tgt.cycle ? "same" : "cycle_change"
          : tgt.price > cur.price ? "upgrade" : tgt.price < cur.price ? "downgrade" : "same";
      expect(kind).toBe(expectedKind);
      expect(changeTiming(kind)).toBe(
        kind === "downgrade" ? "period_end" : kind === "same" ? "none" : "immediate"
      );
    }
  });

  it("webhook stays the only writer: Checkout writes only customer id and mode", () => {
    const src = readFileSync(resolve(__dirname, "../../../app/api/stripe/checkout/route.ts"), "utf8");
    const updates = [...src.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(updates.length).toBeGreaterThan(0);
    for (const body of updates) {
      const keys = [...body.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
      expect(keys).toEqual(["stripe_customer_id", "stripe_mode", "updated_at"]);
    }

    for (const s of ["active", "trialing", "past_due", "unpaid", "canceled", "incomplete_expired", "paused", "incomplete"]) {
      const expectedStatus =
        s === "active" ? "active" : s === "trialing" ? "trial"
          : s === "canceled" || s === "incomplete_expired" ? "cancelled"
            : s === "paused" ? "paused" : "past_due";
      expect(mapStripeStatus(s)).toBe(expectedStatus);
      expect(shouldClearComp(s)).toBe(s === "active" || s === "trialing");
    }
  });

  it("webhook never lifts a pause for a subscription that predates it", () => {
    const r = rng(6007);
    for (let i = 0; i < ITER; i++) {
      const pausedAtMs = NOW - Math.floor(r() * 30) * DAY;
      const args = {
        isPaused: r() < 0.8,
        pausedAt: r() < 0.1 ? null : iso(pausedAtMs),
        incomingStatus: pick(r, ["active", "trialing", "past_due", "unpaid", "canceled", "incomplete"]),
        incomingCreated: Math.floor((pausedAtMs + (r() < 0.5 ? -1 : 1) * Math.floor(r() * 10) * DAY) / 1000),
        incomingHasPauseCollection: r() < 0.4,
      };
      const lifts =
        args.isPaused &&
        args.pausedAt !== null &&
        LIVE.has(args.incomingStatus) &&
        !args.incomingHasPauseCollection &&
        args.incomingCreated * 1000 > Date.parse(args.pausedAt);
      if (lifts) continue; // the approved "buying a plan ends the pause" domain
      expect(webhookClearsPauseUnderTest(args), JSON.stringify(args)).toBe(false);
    }
  });
});
