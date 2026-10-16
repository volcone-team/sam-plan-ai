/**
 * Does this company have a LIVE Stripe subscription?
 *
 * WHY THIS EXISTS. "There is a subscription id on the row" was used as "this
 * customer is subscribed". After a comp was granted and then revoked, a
 * company kept the id of a subscription Stripe had already CANCELED. The
 * Settings panel then offered "Switch to this plan" (change-plan) instead of
 * Checkout, and change-plan answered `no_change` or a Stripe error, so the
 * customer could not buy anything (spec results-expenses-billing-access-fix,
 * Unit C, H1 + H3).
 *
 * A canceled, incomplete or otherwise non-live subscription is treated as NO
 * subscription. Only a live one can be changed; everything else buys afresh
 * through Checkout.
 *
 * Pure, and imports only `plan-change` (itself import-free), because the Edge
 * middleware loads this module on every request. That is also why the mode tag
 * is repeated here rather than imported from `stripe-client`, which pulls in
 * the Stripe SDK. `live-subscription.test.ts` asserts the two stay equal.
 */

import { isLiveSubscription } from "./plan-change";

/** Must equal STRIPE_MODE_TAG in stripe-client.ts (asserted in the test). */
export const LIVE_MODE_TAG = "live";

/**
 * The local `status` column is written with the British spelling 'cancelled'
 * (see mapStripeStatus), while Stripe and `evaluateAccess` use 'canceled'.
 * Normalise before any decision so the two spellings mean the same thing.
 */
export function normaliseSubscriptionStatus(status: string | null | undefined): string | null {
  if (status === undefined || status === null) return null;
  return status === "cancelled" ? "canceled" : status;
}

export interface LiveSubscriptionRow {
  stripe_subscription_id?: string | null;
  stripe_mode?: string | null;
  stripe_status?: string | null;
  status?: string | null;
}

/**
 * True only when a subscription id is stored, it belongs to this mode, and its
 * status (`stripe_status ?? status`) is live: active, trialing, past_due or
 * unpaid (`isLiveSubscription`).
 */
export function hasLiveStripeSubscription(row: LiveSubscriptionRow | null | undefined): boolean {
  if (!row?.stripe_subscription_id) return false;
  if (row.stripe_mode !== LIVE_MODE_TAG) return false;
  return isLiveSubscription(normaliseSubscriptionStatus(row.stripe_status ?? row.status ?? null));
}

export interface PausableRow extends LiveSubscriptionRow {
  is_paused?: boolean | null;
  is_comped?: boolean | null;
}

/**
 * "Buying a plan ends the pause" (user decision, task 18).
 *
 * A paused company with no live Stripe subscription may go through Checkout;
 * the webhook then clears the pause when the new subscription lands.
 *
 * NOT for a paused company with a live subscription: an admin must resume it,
 * exactly as before. NOT for a comped one either: the comp is admin-held, and a
 * paid subscription bought on top of it could not then be changed or cancelled
 * (both refuse comped accounts).
 */
export function canPurchaseWhilePaused(row: PausableRow | null | undefined): boolean {
  if (!row?.is_paused) return false;
  if (row.is_comped) return false;
  return !hasLiveStripeSubscription(row);
}

/**
 * What a paused-but-purchasable account may reach. Deliberately a SUBSET of
 * the lockout allow-list: the purchase journey and what the pages need to
 * render, nothing that manages an existing subscription (portal, cancel,
 * pause/resume, retention offers).
 */
const PAUSED_PURCHASE_PREFIXES: readonly string[] = [
  "/choose-plan",
  "/checkout",
  "/welcome",
  "/api/stripe/checkout",
  "/api/billing/me",
  "/api/billing/reconcile",
  "/api/auth",
];

/** Exact only, as in lockout.ts: `/api/me/password` must stay blocked. */
const PAUSED_PURCHASE_EXACT: ReadonlySet<string> = new Set(["/api/me"]);

export function isAllowedWhilePausedWithoutSubscription(pathname: string): boolean {
  if (PAUSED_PURCHASE_EXACT.has(pathname)) return true;
  return PAUSED_PURCHASE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

export type ChangePlanRow = PausableRow;

export type ChangePlanGuard =
  | { ok: true }
  | { ok: false; status: number; error: "comped_account" | "no_subscription" | "no_live_subscription" | "account_paused" };

/**
 * The checks /api/stripe/change-plan makes BEFORE talking to Stripe.
 *
 * Order matters and the first two are unchanged:
 *   1. comped           -> 400 comped_account (no Stripe subscription to modify)
 *   2. no id / mode     -> 404 no_subscription
 *   3. id but not live  -> 409 no_live_subscription. Previously this went on to
 *                          classify against stale data (`no_change`) or call
 *                          Stripe on a canceled subscription (500).
 *   4. paused + live    -> 403 account_paused. The middleware already refuses
 *                          this for customers; stated here so super admins,
 *                          who bypass the middleware, get the same answer.
 */
export function changePlanGuard(row: ChangePlanRow | null | undefined): ChangePlanGuard {
  if (row?.is_comped) return { ok: false, status: 400, error: "comped_account" };
  if (!row?.stripe_subscription_id || row.stripe_mode !== LIVE_MODE_TAG) {
    return { ok: false, status: 404, error: "no_subscription" };
  }
  if (!hasLiveStripeSubscription(row)) {
    return { ok: false, status: 409, error: "no_live_subscription" };
  }
  if (row.is_paused) return { ok: false, status: 403, error: "account_paused" };
  return { ok: true };
}
