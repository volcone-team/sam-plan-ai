/**
 * The onboarding call gate: a paid customer waits for their call before the
 * portal opens.
 *
 * The order the owner asked for is: sign up -> pick plan -> pay -> thank-you
 * page with a "Book a call with us" button -> an admin opens the portal once
 * the call has happened. This module is the rule that decides whether a given
 * request is on the wrong side of that door.
 *
 * NOT BILLING, and deliberately not expressed through it. `evaluateAccess`
 * (src/lib/billing/entitlement.ts) answers "have they paid"; this answers "has
 * anyone spoken to them yet". A company can be unlocked and still owe money,
 * or be comped and still be waiting for its call, so folding this into the
 * billing decision would make each state able to mask the other. Two gates,
 * evaluated independently.
 *
 * Pure: no database, no Stripe, no request object. The caller supplies the
 * company columns, which is what lets the middleware (Edge), the APIs and the
 * admin table share one decision instead of three.
 *
 * Shaped after src/lib/billing/lockout.ts and
 * src/lib/admin/impersonation-blocked.ts on purpose — prefix list, exact-match
 * set, method map, one predicate — so the next reader sees one family of gates
 * rather than three dialects.
 */

import { IMPERSONATION_EXIT_PATH } from "@/lib/admin/impersonation-blocked";

/**
 * The company columns this decision needs (migration 043).
 *
 * Both OPTIONAL, and that is load-bearing: migration 043 is applied by hand,
 * so until it runs a selected row simply has neither field. Absent reads as
 * "not gated", which is the same answer the global switch gives while the
 * column is missing.
 */
export interface CallGateCompany {
  requires_call_unlock?: boolean | null;
  portal_access_granted_at?: string | null;
}

/**
 * Is this company still waiting for its onboarding call?
 *
 * The flag SET and no grant timestamp. Those two columns together are the
 * whole gate:
 *
 *   flag false                -> never gated. Every company that existed when
 *                                043 ran is here, which is precisely why
 *                                turning the feature on cannot lock out an
 *                                existing customer.
 *   flag true,  granted null  -> waiting. Blocked.
 *   flag true,  granted set   -> had their call. Never blocked again, even if
 *                                the flag stays true — the grant is kept
 *                                rather than clearing the flag so the audit
 *                                trail (who opened it, when) survives.
 */
export function needsCallUnlock(company: CallGateCompany | null | undefined): boolean {
  if (!company) return false;
  if (company.requires_call_unlock !== true) return false;
  return !company.portal_access_granted_at;
}

/**
 * Routes a customer awaiting their call may still reach.
 *
 * AS SHORT AS "NOTHING" ALLOWS. The owner's decision was that a blocked
 * customer can do nothing in the app: no dashboard, no intake, no settings,
 * and no buying either — unlike the billing lockout, which exists precisely to
 * sell them something. So none of /choose-plan, /checkout, /api/billing/* or
 * /api/stripe/* appears here. They have already paid; the only thing left to
 * do is attend the call.
 *
 * Each entry earns its place:
 *
 *   /welcome      The thank-you page itself, which carries the booking button.
 *                 Without it the redirect would loop forever.
 *   /auth         Sign in and sign out. Signing out must ALWAYS work: being
 *                 unable to leave an account you cannot use is the one way
 *                 this feature could trap somebody. Also lets them switch
 *                 accounts, and covers /auth/confirmed and /auth/verify-code.
 *   /api/auth     The sign-out and 2FA endpoints behind those pages. Blocking
 *                 them would mean the 2FA challenge could never be answered,
 *                 so the customer could not even reach the thank-you page.
 */
const ALLOWED_PREFIXES: readonly string[] = [
  "/welcome",
  "/auth",
  "/api/auth",
];

/**
 * Where a blocked customer is sent, and the page that must stay reachable.
 *
 * Exported so the middleware, the thank-you page and the admin table name the
 * same route. `/welcome` already exists as the post-payment page, so it
 * becomes the thank-you page rather than a second near-identical screen.
 */
export const CALL_GATE_PAGE = "/welcome";

/**
 * Allowed as an EXACT path only.
 *
 * `/api/me` is how the AuthProvider renders any page, including the thank-you
 * page, so it has to be reachable. It is NOT a prefix entry: `/api/me/password`
 * lives under it and must stay blocked. Copied from isAllowedWhileLockedOut,
 * which makes the same distinction for the same reason.
 *
 * IMPERSONATION_EXIT_PATH is here because an admin viewing a blocked customer
 * would otherwise have no way out: every page would bounce to the thank-you
 * page and the Exit button's endpoint would be refused, leaving them wearing
 * the customer's session until they signed out entirely. Same exemption
 * isBlockedWhileImpersonating makes against its own prefix rules.
 */
const ALLOWED_EXACT: ReadonlySet<string> = new Set([
  "/api/me",
  IMPERSONATION_EXIT_PATH,
]);

/**
 * Blocked even though the path is allowed, because of the method.
 *
 * `/api/me` is GET for the profile every page needs and DELETE for account
 * deletion. "Can do nothing in the app" includes destroying the account and
 * its Stripe subscription from a screen that is meant to say "we'll see you on
 * the call", so the method decides. Same shape as
 * impersonation-blocked.ts's BLOCKED_EXACT_METHODS.
 */
const BLOCKED_EXACT_METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["/api/me", new Set(["DELETE"])],
]);

/**
 * Is this request allowed while the company awaits its call?
 *
 * @param pathname URL pathname, no query string.
 * @param method   HTTP method; defaults to GET for page navigations.
 */
export function isAllowedWhileAwaitingCall(pathname: string, method: string = "GET"): boolean {
  if (!pathname) return false;

  const blockedMethods = BLOCKED_EXACT_METHODS.get(pathname);
  if (blockedMethods?.has(method.toUpperCase())) return false;

  if (ALLOWED_EXACT.has(pathname)) return true;

  // Segment boundaries, not string prefixes: /api/mentions must not be caught
  // by /api/me, and /welcome-back is not /welcome.
  return ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

/** Why the gate decided what it did. Reported for logging and for the UI copy. */
export type CallGateReason =
  /** Super admin: never gated. */
  | "admin"
  /** No company on the session, so there is nothing to gate (and no customer). */
  | "no_company"
  /** The flag is not set: this company was never part of the gate. */
  | "not_gated"
  /** Flagged, but an admin already opened the portal. */
  | "already_granted"
  /** Flagged and waiting, but this path is on the allow-list. */
  | "allowed_path"
  /** Flagged, waiting, and this request is refused. */
  | "awaiting_call";

export interface CallGateDecision {
  blocked: boolean;
  reason: CallGateReason;
}

/**
 * The single call-gate decision, used by the middleware, the APIs and the
 * admin table.
 *
 * INDEPENDENT OF BILLING BY DESIGN. It takes no subscription, no settings and
 * no clock: it cannot be satisfied by paying and cannot be defeated by owing.
 * The caller runs it alongside the billing gate, not inside it.
 *
 * STRIPE WEBHOOKS ARE UNAFFECTED, and this is worth stating because their
 * absence from the middleware's public list was once a real outage. Two
 * reasons they cannot be caught here. First, the webhook is a server calling a
 * server: there is no session and therefore no company, so `company` is null
 * and the gate passes with "no_company". Second, the middleware short-circuits
 * every `isPublicApiRoute` before any gate runs, so this function is not even
 * consulted. They are left OUT of the allow-list deliberately — listing them
 * would suggest the gate ever sees them.
 */
export function decideCallGate(args: {
  /**
   * profiles.is_admin. A super admin is NEVER blocked: they are the people who
   * do the unlocking, and the admin screens are where it happens. Same
   * exemption decideBillingGate makes, for the same reason.
   */
  isAdmin: boolean;
  company: CallGateCompany | null | undefined;
  pathname: string;
  /** Defaults to GET, which is what a page navigation is. */
  method?: string;
}): CallGateDecision {
  if (args.isAdmin) return { blocked: false, reason: "admin" };
  if (!args.company) return { blocked: false, reason: "no_company" };

  if (args.company.requires_call_unlock !== true) {
    return { blocked: false, reason: "not_gated" };
  }
  if (!needsCallUnlock(args.company)) {
    return { blocked: false, reason: "already_granted" };
  }

  if (isAllowedWhileAwaitingCall(args.pathname, args.method ?? "GET")) {
    return { blocked: false, reason: "allowed_path" };
  }

  return { blocked: true, reason: "awaiting_call" };
}

/**
 * What a blocked API call says.
 *
 * Names the reason, because the usual reading of a refusal ("my account is
 * broken" or "I have not paid") is wrong here — they have paid, and nothing is
 * wrong. One more step, and it involves a person.
 */
export const CALL_GATE_BLOCKED_MESSAGE =
  "Your account opens after your onboarding call. Book your call and we'll unlock everything for you.";
