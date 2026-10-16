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
 * Edge-safe: imports only pure, import-free billing modules.
 */

import { evaluateAccess, type AccessDecision, type AccessReason, type BillingSettings } from "./entitlement";
import { requiresPurchase, isAllowedWhileLockedOut } from "./lockout";
import {
  canPurchaseWhilePaused,
  isAllowedWhilePausedWithoutSubscription,
} from "./live-subscription";

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

  const access = evaluateAccess(
    args.settings,
    {
      status: (gateSub?.stripe_status ?? gateSub?.status ?? null) as never,
      isComped: gateSub?.is_comped ?? false,
      compedUntil: gateSub?.comped_until ?? null,
      trialEndsAt: gateSub?.trial_ends_at ?? null,
      currentPeriodEnd: gateSub?.current_period_end ?? null,
      pastDueSince: gateSub?.past_due_since ?? null,
      cancelAtPeriodEnd: gateSub?.cancel_at_period_end ?? false,
      // The pause was handled above; evaluate what lies underneath it.
      isPaused: false,
    },
    args.now
  );

  if (
    !access.allowed &&
    requiresPurchase(access.reason) &&
    !isAllowedWhileLockedOut(args.pathname)
  ) {
    return { kind: "purchase", reason: access.reason };
  }
  return { kind: "pass" };
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
