/**
 * Why an account is locked out, and what to say about it.
 *
 * Three different situations land a customer on the purchase screen, and they
 * are NOT the same thing to the person reading it:
 *
 *   trial_expired    — they used the product, time ran out
 *   no_subscription  — they registered but never paid (abandoned Checkout)
 *   canceled         — they paid before and stopped
 *
 * Telling an abandoned signup "your trial has ended" is wrong, and telling a
 * long-standing customer whose card lapsed "choose a plan to get started" is
 * worse. One page, copy selected from the reason.
 *
 * Pure: no database, no Stripe. The caller supplies the reason from
 * `evaluateAccess`, which is the same decision the API enforcement path uses,
 * so the page and the gate cannot disagree.
 */

import type { AccessReason } from "./entitlement";

/**
 * Reasons that mean "pay to continue".
 *
 * `paused` is deliberately ABSENT: an admin-paused account cannot fix itself by
 * paying, so it goes to /account-paused instead. Offering a purchase button
 * there would take money and still leave them locked out.
 */
const PURCHASE_REQUIRED: ReadonlySet<AccessReason> = new Set<AccessReason>([
  "trial_expired",
  "no_subscription",
  "canceled",
  "comp_expired",
  "past_due_expired",
  "incomplete",
]);

export function requiresPurchase(reason: AccessReason): boolean {
  return PURCHASE_REQUIRED.has(reason);
}

export interface LockoutCopy {
  /** Page heading. */
  title: string;
  /** One or two sentences: what happened, and that their work is safe. */
  body: string;
  /** Label for the primary action. */
  cta: string;
}

/**
 * Copy for the purchase screen.
 *
 * Every variant says the DATA IS INTACT. Someone locked out assumes the worst,
 * and a plan they can no longer see feels deleted — which also pre-empts the
 * support question this screen would otherwise generate.
 */
export function lockoutCopy(reason: AccessReason, planName?: string | null): LockoutCopy {
  switch (reason) {
    case "trial_expired":
      return {
        title: "Your free trial has ended",
        body:
          "Choose a plan to pick up where you left off. Your plan, initiatives " +
          "and numbers are all still here — nothing has been deleted.",
        cta: "Choose a plan",
      };

    case "no_subscription":
      return {
        title: "Choose a plan to get started",
        body:
          "Your account is ready. Pick the plan that fits and you'll be " +
          "straight into building your revenue plan.",
        cta: "Choose a plan",
      };

    case "canceled":
      return {
        title: "Your subscription has ended",
        body:
          planName
            ? `Your ${planName} subscription has been cancelled. Everything you built ` +
              "is still saved — choose a plan to get access back."
            : "Everything you built is still saved. Choose a plan to get access back.",
        cta: "Choose a plan",
      };

    case "comp_expired":
      return {
        title: "Your complimentary access has ended",
        body:
          "Thanks for trying SAM Plan AI. Your work is still saved — choose a " +
          "plan to carry on.",
        cta: "Choose a plan",
      };

    case "past_due_expired":
      /*
       * A FAILED PAYMENT, not a choice. This customer was paying and wants to
       * keep paying, so the wording blames the card rather than them, and the
       * action is to fix the payment method.
       */
      return {
        title: "We couldn't take your last payment",
        body:
          "Your access is on hold until the payment goes through. Update your " +
          "card and everything comes straight back — nothing has been deleted.",
        cta: "Update payment details",
      };

    case "incomplete":
      // Checkout was started and never finished, so there is a half-made
      // subscription in Stripe. "Finish" is accurate; "choose a plan" is not.
      return {
        title: "Your payment wasn't completed",
        body:
          "It looks like checkout was interrupted. Finish setting up your plan " +
          "to get started.",
        cta: "Finish checkout",
      };

    case "paused":
      /*
       * Only shown on /choose-plan to a paused account with NO live
       * subscription (canPurchaseWhilePaused). User decision: "Buying a plan
       * ends the pause". A paused account that still has a live subscription
       * never sees this; it goes to /account-paused.
       */
      return {
        title: "Your account is paused",
        body:
          "There is no active subscription on this account. Choose a plan to " +
          "restore access — buying a plan ends the pause. Everything you built " +
          "is still saved.",
        cta: "Choose a plan",
      };

    default:
      // Reached only if a new denying reason is added without copy for it.
      // Vague but honest, rather than asserting something that may be false.
      return {
        title: "Choose a plan to continue",
        body: "Your account needs an active plan. Your saved work is unaffected.",
        cta: "Choose a plan",
      };
  }
}

/**
 * Routes a locked-out customer may still reach.
 *
 * Deliberately short. Everything else redirects to the purchase screen,
 * including /settings — plan purchase moved to its own page precisely so that
 * profile, team and notification settings could be blocked without taking the
 * purchase flow with them.
 *
 * Each entry earns its place:
 *   /choose-plan      the purchase screen itself, or the redirect loops
 *   /api/billing      checkout, portal and reconcile: how they get out of this
 *   /api/me           the AuthProvider cannot render any page without it
 *   /api/auth         sign-out and the 2FA endpoints
 *   /auth             sign-in pages, so they can switch accounts
 *   /account-paused   a paused account is a different state with its own page
 */
const ALLOWED_PREFIXES: readonly string[] = [
  "/choose-plan",
  "/account-paused",
  "/auth",
  "/api/billing",
  "/api/auth",
  /*
   * The no-trial signup flow. A user who has registered but not yet paid is
   * locked out BY DEFINITION — they have no subscription — so blocking these
   * would make the purchase journey impossible to complete.
   *
   * /welcome is included because Stripe returns there after a successful
   * payment, and the webhook that records it may not have arrived yet. Being
   * bounced to a purchase screen seconds after paying is the worst possible
   * moment to doubt the product. The page evaluates entitlement itself and
   * redirects if they genuinely have none.
   */
  "/checkout",
  "/welcome",
  "/api/stripe/checkout",
  "/api/stripe/portal",
];

/**
 * Allowed as an EXACT path only.
 *
 * `/api/me` is how the AuthProvider renders any page, so it has to be
 * reachable — but it is not a prefix entry, because `/api/me/password` and the
 * account-deletion handler live under it and must stay blocked.
 */
const ALLOWED_EXACT: ReadonlySet<string> = new Set(["/api/me"]);

export function isAllowedWhileLockedOut(pathname: string): boolean {
  if (ALLOWED_EXACT.has(pathname)) return true;
  return ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}
