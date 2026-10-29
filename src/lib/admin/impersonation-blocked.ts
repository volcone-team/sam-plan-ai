/**
 * What a super admin may NOT do while signed in as a customer.
 *
 * Pure predicate so the rule is testable and so the middleware (Edge) and the
 * UI can agree without duplicating a list.
 *
 * The guiding line: impersonation exists to SEE and OPERATE the customer's
 * plan. It must not be able to take the account away from them, and it must
 * not be a back door into admin tooling.
 */

/**
 * Blocked prefixes, with the reason each earns its place.
 *
 *  /admin, /api/admin
 *    An admin acting as a customer must not reach admin tools. Two reasons.
 *    First, blast radius: those endpoints authorize on `is_admin`, and the
 *    session user is now the CUSTOMER, so they would mostly 403 anyway — but
 *    `requireAdmin` reads the profile of whoever is signed in, and a customer
 *    who happened to be an admin of their own company would get further than
 *    intended. Second, and more practically, it stops an admin starting a
 *    SECOND impersonation from inside the first, which would overwrite the
 *    return ticket and strand them as the customer permanently.
 *    The exit endpoint is exempted below — it lives under this prefix and is
 *    the one admin route that MUST stay reachable.
 *
 *  /api/auth/2fa
 *    LOAD-BEARING for requirement 7. `send` would email a code to the
 *    customer's real inbox, which is both alarming to them and useless to the
 *    admin. `grant` would mint a 30-day `sam_2fa` device-trust cookie for the
 *    CUSTOMER's user id on the admin's laptop, outliving the impersonation by
 *    a month. `revoke` would tear down the customer's own trusted devices.
 *    None of these are things "viewing as" should be able to do, and the
 *    middleware satisfies the 2FA gate from the marker instead, so nothing
 *    here is needed to use the app.
 *
 *  /api/me/password
 *    A password change locks the real customer out of their own account.
 *
 *  /auth/set-password, /auth/reset-password
 *    The same capability by another door, and reachable by accident. An
 *    impersonated session is minted with generateLink + verifyOtp, so its
 *    `amr` is 'otp' — the middleware's link-only confinement would, for an
 *    owner who never chose a password, have sent the admin straight to
 *    /auth/set-password. That confinement is now skipped for a verified
 *    impersonation, and these pages are refused outright so the admin cannot
 *    navigate to them manually either. Changing a customer's password is not
 *    part of "viewing as".
 */
const BLOCKED_PREFIXES: readonly string[] = [
  '/admin',
  '/api/admin',
  '/api/auth/2fa',
  // Consent belongs to the person. An admin viewing as them must not give it.
  '/api/auth/invite-consent',
  '/api/me/password',
  '/auth/set-password',
  '/auth/reset-password',
];

/**
 * The single exception inside a blocked prefix.
 *
 * Exiting is how the admin stops being the customer. If this were blocked by
 * the `/api/admin` rule above, the Exit button would 403 and the only way back
 * would be to sign out and sign in again — and an admin who closed the banner
 * would simply stay signed in as the customer. Allowing it removes nothing:
 * the handler's own authorization is the signed, httpOnly return ticket, which
 * only the admin who started this can hold.
 */
export const IMPERSONATION_EXIT_PATH = '/api/admin/impersonate/exit';

/**
 * Blocked only for a specific method.
 *
 * `/api/me` is GET for the profile the AuthProvider needs on every page, and
 * DELETE for account deletion. The path cannot be blocked wholesale without
 * breaking every screen, so the method decides.
 */
const BLOCKED_EXACT_METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['/api/me', new Set(['DELETE'])],
]);

/**
 * Is this request blocked while impersonating?
 *
 * NOTE WHAT IS *NOT* HERE: billing. Checkout, plan changes, cancellation, the
 * Stripe portal and retention offers are all ALLOWED, by the owner's explicit
 * decision — an admin helping a customer through a plan change is a main use
 * of this feature. Those actions move real money, which is why the banner says
 * so out loud rather than the code quietly preventing it.
 *
 * @param pathname URL pathname, no query string.
 * @param method   HTTP method; defaults to GET for page navigations.
 */
export function isBlockedWhileImpersonating(
  pathname: string,
  method: string = 'GET'
): boolean {
  if (!pathname) return false;

  // The exit route wins over every prefix rule below.
  if (pathname === IMPERSONATION_EXIT_PATH) return false;

  const methods = BLOCKED_EXACT_METHODS.get(pathname);
  if (methods && methods.has(method.toUpperCase())) return true;

  return BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Message shown when a blocked action is attempted. Says which account the
 * admin must return to in order to do it, because the usual reading of a 403
 * ("I lack permission") is wrong here — they have permission, just not while
 * wearing someone else's session.
 */
export const IMPERSONATION_BLOCKED_MESSAGE =
  'Not available while viewing as a customer. Exit impersonation to do this from your own account.';
