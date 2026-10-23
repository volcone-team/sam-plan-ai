/**
 * The middleware's billing gate, as a pure function.
 *
 * Extracted from src/lib/supabase/middleware.ts so the paused and entitlement
 * decisions can be tested without a request, and so the one approved change
 * ("Buying a plan ends the pause") sits next to the rules it must not disturb.
 *
 * Behaviour is identical to the inline version except for ONE case: a paused
 * company with no live Stripe subscription (and not comped) may reach the
 * purchase journey (`isAllowedWhilePausedWithoutSubscription`). Everything
 * else a paused company asks for is still refused, and a paused company with a
 * live subscription is refused everywhere, exactly as before.
 *
 * Edge-safe: imports only pure, import-free billing modules — and, for
 * `decideAccessGates` below, the equally pure onboarding call gate.
 */

import { evaluateAccess, type AccessDecision, type AccessReason, type BillingSettings } from "./entitlement";
import { requiresPurchase, isAllowedWhileLockedOut } from "./lockout";
import {
  canPurchaseWhilePaused,
  isAllowedWhilePausedWithoutSubscription,
} from "./live-subscription";
import { decideCallGate, type CallGateCompany } from "@/lib/access/call-gate";

/** The subscription columns the middleware selects. */
export interface GateSubRow {
  is_paused: boolean | null;
  pause_resumes_at: string | null;
  status: string | null;
  stripe_status: string | null;
  is_comped: boolean | null;
  comped_until: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  cancel_at_period_end: boolean | null;
  stripe_subscription_id: string | null;
  stripe_mode: string | null;
}

/**
 * The entitlement evaluation both gates share. The pause is deliberately
 * evaluated as off: decideBillingGate handles it before asking this, so this
 * answers "what lies underneath the pause".
 */
function evaluateGateAccess(
  settings: BillingSettings,
  gateSub: GateSubRow | null,
  now?: number
): AccessDecision {
  return evaluateAccess(
    settings,
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
    now
  );
}

export type GateDecision =
  | { kind: "pass" }
  | { kind: "paused" }
  | { kind: "purchase"; reason: AccessReason };

export function decideBillingGate(args: {
  /** Super admins are never locked out: they are the people who undo it. */
  isAdmin: boolean;
  hasCompany: boolean;
  sub: GateSubRow | null;
  settings: BillingSettings;
  pathname: string;
  now?: number;
}): GateDecision {
  if (!args.hasCompany || args.isAdmin) return { kind: "pass" };

  const gateSub = args.sub;

  if (gateSub?.is_paused) {
    const mayBuy =
      canPurchaseWhilePaused(gateSub) &&
      isAllowedWhilePausedWithoutSubscription(args.pathname);
    if (!mayBuy) return { kind: "paused" };
    // Falls through to the entitlement gate, which allows these same paths.
  }

  const access = evaluateGateAccess(args.settings, gateSub, args.now);

  if (
    !access.allowed &&
    requiresPurchase(access.reason) &&
    !isAllowedWhileLockedOut(args.pathname)
  ) {
    return { kind: "purchase", reason: access.reason };
  }
  return { kind: "pass" };
}

/* ------------------------------------------------------------------ *
 * The middleware's two gates, combined
 * ------------------------------------------------------------------ */

/** As GateDecision, plus "has paid, but nobody has spoken to them yet". */
export type AccessGateDecision = GateDecision | { kind: "awaiting_call" };

/**
 * Every access decision the middleware makes for a customer request, in order.
 *
 * ONE FUNCTION so the ORDER of the two gates is a tested fact rather than a
 * detail of how the middleware happens to be written. The gates themselves
 * stay separate and are unchanged: `decideBillingGate` answers "have they
 * paid", `decideCallGate` answers "has anyone spoken to them yet", and neither
 * knows about the other.
 *
 * BILLING FIRST, CALL GATE SECOND, which is the opposite of the obvious
 * reading ("they have already paid, so do not send them to /choose-plan").
 * Three facts decide it:
 *
 *   1. The stamp lands at COMPANY CREATION, not at payment — the switch is
 *      snapshotted onto the new row (migration 043, and the trigger-written
 *      signup row the backstop exists for). So "flagged" does NOT imply
 *      "paid". In the no-trial flow a company is flagged from the moment it
 *      registers, several minutes before Stripe takes anything.
 *   2. For such a company the call gate running first would answer the
 *      dashboard with a redirect to the thank-you page — and the thank-you
 *      page evaluates entitlement itself and redirects an unentitled visitor
 *      straight to /choose-plan (src/app/welcome/page.tsx). So call-first
 *      cannot keep an unpaid company out of the purchase screen; it only adds
 *      a hop on the way there.
 *   3. Billing-first makes the owner's rule ("the gate is AFTER payment") fall
 *      out of the ordering instead of having to be re-stated: a company with
 *      nothing to its name is sent to buy, and only once it is entitled does
 *      the call gate become the thing standing in its way.
 *
 * A gated company whose subscription later lapses is therefore sent to
 * /choose-plan rather than to the thank-you page. That is deliberate: at that
 * point it genuinely has not paid, and no gate should hide that from it.
 *
 * NOT CONSULTED AT ALL for the purchase journey (/choose-plan, /checkout,
 * /welcome) or for public API routes, because the middleware does not run this
 * block for them — see the note at the call site. That is what keeps a flagged
 * company able to finish paying.
 */
export function decideAccessGates(args: {
  isAdmin: boolean;
  hasCompany: boolean;
  sub: GateSubRow | null;
  settings: BillingSettings;
  /**
   * The migration-043 columns, or null when the row could not be read.
   *
   * Null means NOT GATED. Until 043 is applied by hand the select fails and
   * every caller passes null, and locking paying customers out because a
   * column is missing is the one failure this feature may not have.
   */
  company: CallGateCompany | null;
  pathname: string;
  /** Defaults to GET, which is what a page navigation is. */
  method?: string;
  now?: number;
}): AccessGateDecision {
  const billing = decideBillingGate({
    isAdmin: args.isAdmin,
    hasCompany: args.hasCompany,
    sub: args.sub,
    settings: args.settings,
    pathname: args.pathname,
    now: args.now,
  });
  if (billing.kind !== "pass") return billing;

  /*
   * The call gate applies to ENTITLED companies only. Billing also answers
   * "pass" for an unentitled company on a path it may use while locked out
   * (/api/stripe/checkout, /api/billing/*). The call gate deliberately blocks
   * buying, so letting it see that request would stop a flagged company from
   * ever paying. The owner's rule: the call comes AFTER payment.
   */
  if (
    args.hasCompany &&
    !args.isAdmin &&
    !evaluateGateAccess(args.settings, args.sub, args.now).allowed
  ) {
    return { kind: "pass" };
  }

  const call = decideCallGate({
    isAdmin: args.isAdmin,
    company: args.company,
    pathname: args.pathname,
    method: args.method,
  });

  return call.blocked ? { kind: "awaiting_call" } : { kind: "pass" };
}

/**
 * What /choose-plan does with an access decision.
 *
 *   paused, may not buy -> /account-paused (unchanged)
 *   paused, may buy     -> render the plans; buying ends the pause
 *   entitled            -> back to the app (unchanged)
 *   locked out          -> render (unchanged)
 */
export function decideChoosePlanPage(
  access: AccessDecision,
  sub: GateSubRow | null
): "redirect_paused" | "redirect_app" | "render" {
  if (access.reason === "paused") {
    return canPurchaseWhilePaused(sub) ? "render" : "redirect_paused";
  }
  if (access.allowed || !requiresPurchase(access.reason)) return "redirect_app";
  return "render";
}
