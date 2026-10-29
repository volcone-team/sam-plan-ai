import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TWO_FACTOR_COOKIE, verifyDeviceToken } from '@/lib/two-factor';
import {
  decideAccessGates,
  type AccessGateDecision,
  type GateSubRow,
} from '@/lib/billing/billing-gate';
import { isMissingColumnError } from '@/lib/supabase/missing-column';
import {
  CALL_GATE_BLOCKED_MESSAGE,
  CALL_GATE_PAGE,
  decideCallGate,
  type CallGateCompany,
} from '@/lib/access/call-gate';
import {
  stampCallUnlockForNewCompany,
} from '@/lib/access/call-gate-settings';
import {
  IMPERSONATION_MARKER_COOKIE,
  isMarkerActive,
  isMarkerForUser,
  verifyImpersonationMarker,
  type ImpersonationMarker,
} from '@/lib/admin/impersonation';
import {
  IMPERSONATION_BLOCKED_MESSAGE,
  IMPERSONATION_EXIT_PATH,
  isBlockedWhileImpersonating,
} from '@/lib/admin/impersonation-blocked';

/** The invite consent endpoint (POST from /auth/set-password). */
const INVITE_CONSENT_PATH = '/api/auth/invite-consent';
// IMPERSONATION_EXIT_PATH is referenced by three separate rules below: the
// expired-impersonation redirect, the 2FA exemption, and the billing gates.
// All three exist so that leaving a customer's account can never be refused.

/**
 * Reads the authentication method out of a JWT's `amr` (Authentication Methods
 * References) claim.
 *
 * Supabase records HOW the session was created:
 *   - password sign-in            -> amr: [{ method: 'password', ... }]
 *   - recovery / invite / magic-  -> amr: [{ method: 'otp', ... }]
 *     link / email OTP
 *
 * The shape is intentionally treated as `unknown` and validated at runtime:
 * `amr` is typed as `AMREntry[] | string[]` by auth-js and is ultimately
 * server-controlled data, so we must not assume either form.
 *
 * If ANY entry is a password, the session is password-backed (a session can
 * carry several methods, e.g. after step-up auth). Otherwise we report the most
 * recent (last) entry.
 */
function extractAuthMethod(claims: unknown): string | null {
  if (!claims || typeof claims !== 'object') return null;

  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr) || amr.length === 0) return null;

  const methods = amr
    .map((entry): string | null => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const method = (entry as { method?: unknown }).method;
        if (typeof method === 'string') return method;
      }
      return null;
    })
    .filter((method): method is string => method !== null);

  if (methods.length === 0) return null;
  if (methods.includes('password')) return 'password';

  return methods[methods.length - 1];
}

/**
 * Does this account still need to CHOOSE a password?
 *
 * Set to true when we create a user without one (team invite, admin-created
 * customer) and cleared once they set it on /auth/set-password.
 *
 * This exists because `amr` CANNOT distinguish the three email-link flows —
 * signup confirmation, password recovery and invite all produce
 * `amr: [{ method: 'otp' }]`. Keying confinement on amr alone meant a brand-new
 * user confirming their signup email was mistaken for an invitee and shoved to
 * /auth/set-password, which broke signup entirely.
 */
function needsPasswordSetup(claims: unknown): boolean {
  if (!claims || typeof claims !== 'object') return false;
  const meta = (claims as { user_metadata?: unknown }).user_metadata;
  if (!meta || typeof meta !== 'object') return false;
  return (meta as { needs_password?: unknown }).needs_password === true;
}

/**
 * Edge-safe JWT payload decode (no verification — the payload is only ever used
 * to read `amr`; authentication itself is established by `getClaims()`, which
 * verifies the token signature, or by `getUser()` on the fallback path).
 * `atob` is available on the Edge runtime; base64url needs manual translation.
 */
function decodeJwtPayload(accessToken: string): unknown {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Billing settings for the entitlement gate.
 *
 * Read through the SESSION client, not the service role: the Edge runtime has
 * no service key, and `app_settings` is readable by authenticated users.
 *
 * FAILS OPEN. If the row cannot be read we report billing as DISABLED, which
 * `evaluateAccess` treats as "everyone has access". A settings read failure
 * must degrade to the pre-billing app rather than locking out every paying
 * customer at once — the same rule `loadBillingConfig` follows.
 */
async function loadGateSettings(
  supabase: ReturnType<typeof createServerClient>
): Promise<{
  stripeEnabled: boolean;
  trialEnabled: boolean;
  trialDays: number;
  dunningGraceDays: number;
}> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('stripe_enabled, trial_enabled, trial_days, dunning_grace_days')
      .eq('id', 'global')
      .maybeSingle();

    if (!data) {
      return { stripeEnabled: false, trialEnabled: true, trialDays: 14, dunningGraceDays: 7 };
    }

    const row = data as {
      stripe_enabled?: boolean | null;
      trial_enabled?: boolean | null;
      trial_days?: number | null;
      dunning_grace_days?: number | null;
    };

    return {
      stripeEnabled: row.stripe_enabled === true,
      trialEnabled: row.trial_enabled !== false,
      trialDays: row.trial_days ?? 14,
      dunningGraceDays: row.dunning_grace_days ?? 7,
    };
  } catch {
    return { stripeEnabled: false, trialEnabled: true, trialDays: 14, dunningGraceDays: 7 };
  }
}

/**
 * Supabase middleware helper.
 * Refreshes the auth session on every request to keep it alive.
 * Used in the root middleware.ts file.
 *
 * Gracefully skips auth when Supabase env vars are not configured,
 * allowing the app to run with mock data during development.
 */
export async function updateSession(request: NextRequest) {
  // Skip Supabase auth entirely if credentials are not configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  /**
   * IDENTITY — FAST PATH: locally verified claims.
   *
   * `getClaims()` parses the access token and VERIFIES ITS SIGNATURE (this
   * project uses asymmetric ES256 signing keys, so verification happens locally
   * via WebCrypto against a cached JWKS — ~1ms, no round trip). That signature
   * check is what makes these claims authoritative for authentication, unlike
   * `getSession()`, which returns cookie contents without verifying anything.
   * `getUser()` proves the same thing but costs a ~324ms network call to the
   * Auth server on EVERY request, which is what this avoids.
   */
  // `claims.email` is deliberately not captured here: nothing in this function
  // needs it, and the middleware does not log per-request identity.
  let userId: string | null = null;
  let verifiedClaims: unknown = null;

  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;

    if (claims && typeof claims === 'object') {
      const sub = (claims as { sub?: unknown }).sub;

      if (typeof sub === 'string' && sub.length > 0) {
        verifiedClaims = claims;
        userId = sub;
      }
    }
  } catch {
    // Fall through to the getUser() path below.
  }

  /**
   * SLOW PATH: no usable verified claims — no session at all, an expired access
   * token, an unexpected claim shape, or getClaims() threw.
   *
   * `getUser()` both validates against the Auth server AND lets `@supabase/ssr`
   * write refreshed session cookies, which is exactly what an expiring token
   * needs. The cases where we have no valid token are precisely the cases where
   * a refresh is required, so paying the network cost here (and only here)
   * keeps sessions alive without taxing every authenticated request.
   */
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      userId = user.id;
    }
  }

  const isAuthenticated = !!userId;

  /**
   * How was this session created? Only worth asking when there IS a user —
   * anonymous requests skip the work entirely.
   *
   * Primary source is the verified claims we already hold (no extra call). When
   * identity came from the fallback `getUser()` path we have no claims object,
   * so we decode the access token payload ourselves purely to read `amr` —
   * authentication was already established above, this decode is never trusted
   * for identity.
   */
  const getAuthMethod = async (): Promise<string | null> => {
    if (verifiedClaims) {
      const method = extractAuthMethod(verifiedClaims);
      if (method) return method;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        return extractAuthMethod(decodeJwtPayload(session.access_token));
      }
    } catch {
      // Unknown method — handled conservatively by the caller.
    }

    return null;
  };

  const authMethod = isAuthenticated ? await getAuthMethod() : null;

  /**
   * A "link-only" session was minted by a recovery / invite / magic-link / OTP
   * email. Such a session exists for ONE purpose: to authorize setting a
   * password. It must not grant access to the app.
   *
   * Conservative by design: when the method could NOT be determined
   * (`authMethod === null` — unexpected claim shape, symmetric-key project with
   * no reachable verification, etc.) we do NOT treat the session as link-only.
   * Guessing wrong here would lock every legitimate user out of the product.
   */
  /**
   * Confine only sessions that (a) came from an email link rather than a
   * password sign-in, AND (b) belong to an account that still has no password
   * of its own. Requiring BOTH is what lets a signup confirmation through while
   * still trapping a forwarded invite link.
   */
  const needsPassword = needsPasswordSetup(verifiedClaims);
  const isLinkOnlySession =
    isAuthenticated && authMethod !== null && authMethod !== 'password' && needsPassword;

  // Protected routes: redirect to login if not authenticated
  const isAuthRoute = request.nextUrl.pathname.startsWith('/auth');
  // API routes must never be HTML-redirected — they own their own auth and
  // must return JSON so clients get a real error instead of a login page.
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');
  // Public API routes have no user session by design and enforce their own
  // authorization (e.g. the cron endpoint checks a Bearer CRON_SECRET, the
  // unsubscribe endpoint verifies a signed token). The middleware must let
  // these through so their handlers can run and apply their own auth.
  const isPublicApiRoute =
    request.nextUrl.pathname.startsWith('/api/cron/') ||
    request.nextUrl.pathname.startsWith('/api/notifications/unsubscribe') ||
    /**
     * STRIPE WEBHOOKS. Load-bearing, and its absence here was a real outage.
     *
     * Stripe is a server calling a server: there is no session cookie and
     * never will be. The gate below returns 401 to any unauthenticated API
     * request, so every webhook was rejected by the MIDDLEWARE and the handler
     * never ran — confirmed in the Vercel log as "Middleware 401 Unauthorized"
     * with the Stripe user agent.
     *
     * The consequence was silent and expensive: Stripe took payments, retried
     * delivery, got 401 every time, and the subscription was never recorded.
     * Customers paid and the app believed they had not.
     *
     * It is NOT unauthenticated in substance. The handler verifies the
     * `stripe-signature` HMAC against STRIPE_WEBHOOK_SECRET over the raw body
     * before trusting a single field, which is strictly stronger proof of
     * origin than a session cookie — so letting it through the middleware
     * removes nothing.
     */
    request.nextUrl.pathname === '/api/stripe/webhook' ||
    // Password reset: the caller has lost their password and therefore has no
    // session by definition. The handler withholds whether the address exists
    // and always answers 200, so being public leaks nothing.
    request.nextUrl.pathname === '/api/auth/forgot-password' ||
    /**
     * Direct signup (email verification off). The caller has no account yet,
     * so it has no session by definition. EXACT match only: nothing else under
     * /api/auth becomes public. The handler protects itself with a honeypot,
     * per-IP and per-email rate limits and full re-validation, and it creates
     * nothing at all while the admin's verification switch is on.
     */
    request.nextUrl.pathname === '/api/auth/signup' ||
    /**
     * Whether signup must start with a plan choice. The signup page is reached
     * by ANONYMOUS visitors, so a 401 here would make the page unable to learn
     * the rule and it would fall back to skipping plan selection. Returns a
     * single boolean that the pricing page already discloses.
     */
    request.nextUrl.pathname === '/api/billing/signup-flow' ||
    /**
     * The Privacy Policy and Terms links. Designed to be unauthenticated (see
     * the route) and returns only those two public URLs. Listed here so the
     * checkboxes on /auth/set-password can link them for a link-only session,
     * which may call nothing else.
     */
    request.nextUrl.pathname === '/api/legal-urls';
  // Onboarding is NO LONGER public. The flow is account-first:
  //   Landing -> "Create an Account" -> /auth/signup -> /onboarding/welcome
  // Leaving /onboarding open let anyone walk the questionnaire with no account,
  // and let Back out of the questionnaire escape the flow entirely.
  const isOnboardingRoute = request.nextUrl.pathname.startsWith('/onboarding');
  const isPublicRoute =
    request.nextUrl.pathname === '/' ||
    request.nextUrl.pathname.startsWith('/sample-plan') ||
    // Plan selection BEFORE registering, for the no-trial flow. Public by
    // necessity: there is no account yet, which is the whole point.
    request.nextUrl.pathname.startsWith('/get-started') ||
    request.nextUrl.pathname.startsWith('/admin-login');
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');
  // Where a paused account is sent. Must be excluded from isAppRoute, or the
  // redirect below would target a page that redirects to itself.
  const isPausedRoute = request.nextUrl.pathname.startsWith('/account-paused');
  // The purchase screen, for the same reason.
  const isChoosePlanRoute = request.nextUrl.pathname.startsWith('/choose-plan');
  /**
   * The signup purchase journey. Excluded from isAppRoute so the entitlement
   * gate cannot block the very pages that resolve a lack of entitlement —
   * someone registered but not yet paid has no subscription by definition.
   */
  const isPurchaseFlowRoute =
    request.nextUrl.pathname.startsWith('/checkout') ||
    request.nextUrl.pathname.startsWith('/welcome');
  const isAppRoute =
    !isAuthRoute && !isApiRoute && !isPublicRoute && !isAdminRoute &&
    !isOnboardingRoute && !isPausedRoute && !isChoosePlanRoute &&
    !isPurchaseFlowRoute;

  // Some auth pages must stay reachable EVEN with a session:
  //  - Password-setting pages: an invite or recovery link signs the user in
  //    first (that's how they're authorized to set a password), so bouncing
  //    authenticated users away made it impossible to finish the flow.
  //  - The two-factor challenge: anyone reaching it ALWAYS holds a session by
  //    definition, and the universal 2FA gate below redirects here. Bouncing
  //    them away would make that gate an infinite loop.
  //  - The impersonation exit landing page: it is reached while still holding
  //    the CUSTOMER's session, and its whole job is to POST the exit endpoint
  //    and send the admin home. Bouncing an authenticated visitor away from it
  //    would make an expired impersonation impossible to escape.
  const isAuthFlowRoute =
    request.nextUrl.pathname.startsWith('/auth/set-password') ||
    // The 7-day invite link (migration 057): it forwards to /auth/set-password,
    // and must work even if the browser already holds someone's session.
    request.nextUrl.pathname.startsWith('/auth/invite') ||
    request.nextUrl.pathname.startsWith('/auth/reset-password') ||
    request.nextUrl.pathname.startsWith('/auth/verify-code') ||
    request.nextUrl.pathname.startsWith('/auth/impersonation-ended');

  /**
   * TWO-FACTOR EXEMPTIONS
   *
   * Everything an authenticated user can reach WITHOUT a trusted-device cookie.
   * Get this list wrong and a user can never obtain the cookie in the first
   * place, which means they can never use the product.
   *
   *  1. isAuthFlowRoute — /auth/set-password, /auth/reset-password and the
   *     challenge page itself (/auth/verify-code). Gating the challenge page on
   *     having already passed the challenge is an infinite redirect loop.
   *  2. any /auth/* route — login, signup, forgot-password, callback. These ARE
   *     how people authenticate; a session can linger on them (e.g. mid
   *     sign-out) and they must never be blocked.
   *  3. /api/auth/2fa/* — LOAD-BEARING. The send and verify endpoints are the
   *     only way to get a `sam_2fa` cookie. If the gate covered them, the
   *     challenge page could not request a code and could not submit one, so
   *     the cookie could never be issued and every user would be permanently
   *     locked out. This exemption is what makes the whole gate escapable.
   *  4. exactly /api/me — the AuthProvider calls it to render any page,
   *     including the challenge page. Not /api/me/* (e.g. /api/me/password
   *     stays gated).
   *  5. isPublicApiRoute — /api/cron/*, /api/notifications/unsubscribe. These
   *     enforce their own authorization (Bearer secret / signed token) and are
   *     not user-session routes at all.
   *  6. isPublicRoute — /, /sample-plan*, /admin-login*. Public by design; a
   *     signed-in visitor should still see them.
   *  7. isOnboardingRoute — DELIBERATE PRODUCT DECISION: do not interrupt a
   *     brand-new user mid-questionnaire. They get challenged the moment they
   *     reach an app route afterwards.
   */
  const isTwoFactorExempt =
    isAuthFlowRoute ||
    isAuthRoute ||
    request.nextUrl.pathname.startsWith('/api/auth/2fa') ||
    request.nextUrl.pathname === '/api/me' ||
    // Called from /auth/set-password (itself exempt) before the person has a
    // password, so they cannot have passed the code challenge yet.
    request.nextUrl.pathname === INVITE_CONSENT_PATH ||
    /**
     * 8. the impersonation EXIT endpoint. It is reached while holding the
     *    CUSTOMER's session, so this gate would challenge the customer's inbox
     *    — emailing them a code — just to let an admin leave.
     *
     *    Normally the valid marker below satisfies the gate anyway, so this
     *    changes nothing for the happy path. It matters when the marker is
     *    missing or unreadable while the return ticket is still present: the
     *    exemption is what keeps that recoverable instead of a dead end.
     *
     *    It grants nothing. The handler authorizes on the signed httpOnly
     *    ticket, and every path through it either restores the admin or signs
     *    the browser out — there is no branch that hands over access.
     */
    request.nextUrl.pathname === IMPERSONATION_EXIT_PATH ||
    isPublicApiRoute ||
    isPublicRoute ||
    // A paused user still holds a valid session; sending them through the code
    // challenge to reach a "your plan is paused" page is pure friction.
    isPausedRoute ||
    // Same for the purchase screen: it exists to take money from someone who
    // cannot use the product, and a code challenge in the way only loses sales.
    isChoosePlanRoute;

  // Unauthenticated API calls get a JSON 401, never a redirect — except public
  // API routes, which own their own authorization and must reach their handler.
  if (!isAuthenticated && isApiRoute && !isPublicApiRoute) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  /**
   * ADMIN IMPERSONATION — resolve the marker.
   *
   * See the long note at the enforcement block below for why this is here,
   * ABOVE link-only confinement, rather than next to the rest of it.
   */
  const markerCookie = request.cookies.get(IMPERSONATION_MARKER_COOKIE)?.value ?? null;
  let impersonation: ImpersonationMarker | null = null;
  let impersonationExpired = false;

  if (markerCookie && userId) {
    const marker = await verifyImpersonationMarker(markerCookie);

    if (marker && isMarkerForUser(marker, userId)) {
      if (isMarkerActive(marker)) {
        impersonation = marker;
      } else {
        // Signed, and genuinely this user's, but past the 60-minute limit.
        impersonationExpired = true;
      }
    }
    /*
     * A marker that fails verification, or names a different user, is simply
     * IGNORED — no error, no redirect. It is indistinguishable from junk, and
     * a real user carrying a stale cookie from a previous admin visit must not
     * be inconvenienced by it.
     */
  }

  /**
   * LINK-ONLY SESSION CONFINEMENT
   *
   * A recovery or invite email signs the user in — that IS how they are
   * authorized to choose a password. But that session proves only "someone
   * opened this emailed link", not "someone knows this account's password". A
   * forwarded or leaked link would otherwise be a full account takeover: the
   * user could simply navigate to /year-at-a-glance (or hit Back) and use the
   * whole product without ever setting a password.
   *
   * So while the session is link-only, the ONLY thing it can reach is the
   * password-setting flow:
   *   - /auth/set-password, /auth/reset-password (already in isAuthFlowRoute)
   *   - GET /api/me, which the AuthProvider needs to render those pages
   *   - sign-out, which is a direct client call to Supabase (no route here)
   *
   * Note that `amr` does NOT change after updateUser({ password }) — the
   * session stays 'otp' for its whole life — which is why those pages sign the
   * user out on success and send them to /auth/login to sign in for real.
   *
   * This runs BEFORE the onboarding / app / admin gates so it takes precedence
   * over every other authorization decision below.
   *
   * EXCEPT for a verified impersonation. An impersonated session is minted via
   * generateLink + verifyOtp, so its `amr` is 'otp' — and if the impersonated
   * owner is an invited user who never chose a password, this rule would read
   * that as a leaked email link and redirect the ADMIN to /auth/set-password,
   * offering them a form that sets the CUSTOMER's password. The impersonation
   * was authorized by a super-admin check and a signed marker, not by someone
   * forwarding an email, so the premise of this rule does not hold. Setting
   * the customer's password is blocked outright instead (see
   * impersonation-blocked.ts). The expired case is excluded too, so an admin
   * on their way out is not diverted into password setup.
   */
  if (isLinkOnlySession && !impersonation && !impersonationExpired) {
    // APIs never get an HTML redirect. Only the exact /api/me endpoint is
    // allowed through (not /api/me/* — e.g. /api/me/password already demands
    // the current password and is not part of this flow).
    if (isApiRoute) {
      const isAllowedApi =
        request.nextUrl.pathname === '/api/me' ||
        // The signup checkboxes for invited people, answered on
        // /auth/set-password before the password exists. Writes only the
        // caller's own consent; see the route's header.
        request.nextUrl.pathname === INVITE_CONSENT_PATH ||
        isPublicApiRoute;

      if (!isAllowedApi) {
        return NextResponse.json(
          { error: 'password_setup_required' },
          { status: 403 }
        );
      }
    } else if (isAppRoute || isAdminRoute || isOnboardingRoute) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/set-password';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  /**
   * ADMIN IMPERSONATION
   *
   * When a super admin uses "View Dashboard", they are genuinely signed in as
   * the target company's owner (see /api/admin/impersonate). The session here
   * IS the customer's; the `sam_impersonating` cookie is the only thing that
   * says otherwise.
   *
   * THE MARKER IS SIGNED, AND THAT IS WHY THIS IS SAFE. Below, a valid marker
   * SATISFIES the 2FA gate — so if it were forgeable, any user could set the
   * cookie and skip the code challenge entirely. It carries an HMAC over
   * TWO_FACTOR_SECRET and names the user it belongs to; `isMarkerForUser`
   * binds it to the session actually presenting it, so a copied marker is
   * inert in anyone else's browser.
   *
   * PLACEMENT — BEFORE link-only confinement, which is load-bearing.
   *
   * An impersonated session is minted with `generateLink` + `verifyOtp`, so
   * its `amr` is 'otp', not 'password'. If the impersonated owner is an
   * invited user who never chose a password (`user_metadata.needs_password`),
   * the confinement rule below would classify this as a leaked-email-link
   * session and redirect the ADMIN to /auth/set-password — handing them a form
   * that sets the CUSTOMER's password. That is both a redirect loop out of the
   * feature and a privilege the design explicitly withholds.
   *
   * So the marker is resolved first (further up), confinement is skipped for a
   * verified impersonation, and /auth/set-password is in the blocked list
   * instead.
   */

  /**
   * EXPIRED IMPERSONATION — get the admin out.
   *
   * The session still belongs to the customer, so doing nothing would drop
   * through to the 2FA gate and EMAIL A CODE TO THE CUSTOMER, which is exactly
   * what requirement 7 forbids. Instead every page request is sent to a small
   * page that POSTs the exit endpoint and restores the admin.
   *
   * The exit endpoint itself must stay reachable or this is a dead end.
   */
  if (impersonationExpired && request.nextUrl.pathname !== IMPERSONATION_EXIT_PATH) {
    if (isApiRoute) {
      return NextResponse.json(
        {
          error: 'impersonation_expired',
          message: 'This impersonation session has expired. Returning you to your own account.',
        },
        { status: 403 }
      );
    }

    if (!request.nextUrl.pathname.startsWith('/auth/impersonation-ended')) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/impersonation-ended';
      url.search = '?reason=expired';
      return NextResponse.redirect(url);
    }
  }

  /**
   * BLOCKED ACTIONS WHILE IMPERSONATING.
   *
   * Enforced here, server-side, so hiding the buttons in the UI is a courtesy
   * rather than the control. See impersonation-blocked.ts for what each entry
   * is for; the short version is that an admin acting as a customer may not
   * take the account away from them (password, account deletion, 2FA) and may
   * not reach admin tooling. Billing is deliberately ALLOWED.
   */
  if (impersonation && isBlockedWhileImpersonating(request.nextUrl.pathname, request.method)) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'blocked_while_impersonating', message: IMPERSONATION_BLOCKED_MESSAGE },
        { status: 403 }
      );
    }

    // An admin page while impersonating: send them to the exit page rather
    // than show a dead end, since leaving impersonation is what they want.
    const url = request.nextUrl.clone();
    url.pathname = '/auth/impersonation-ended';
    url.search = '?reason=admin_area';
    return NextResponse.redirect(url);
  }

  /**
   * UNIVERSAL TWO-FACTOR GATE
   *
   * Every authenticated user — customer or admin, page or API — must prove this
   * device passed the emailed code challenge. The `sam_2fa` cookie is that
   * proof: it carries its own HMAC and issue timestamp (30-day trust window),
   * so the check is a single signature verification with no DB lookup.
   *
   * This replaces the two admin-scoped checks that used to live here and in the
   * /admin page gate; one gate now covers /admin/*, /api/admin/*, the customer
   * app, and every other non-exempt API.
   *
   * Placement matters: it runs AFTER the link-only session confinement above,
   * so a session minted by a recovery or invite link is sent to
   * /auth/set-password rather than to the code challenge — password setup takes
   * precedence. It runs BEFORE the onboarding / app / auth / admin gates below.
   */
  /**
   * IMPERSONATION SATISFIES THIS GATE — scoped to this session only.
   *
   * Requirement 7. The gate's question is "has this device proved control of
   * this account's inbox?" For an impersonated session the honest answer is
   * that it cannot and must not: the inbox belongs to the CUSTOMER, and
   * challenging here would email them a code every time an admin looked at
   * their plan.
   *
   * What stands in for the code is the super-admin authorization already
   * performed by /api/admin/impersonate — which itself ran behind this very
   * gate, so the admin HAS passed a code challenge on this device, under their
   * own account, within the last 30 days.
   *
   * Two properties keep this from being a hole:
   *   - the marker is HMAC-signed and bound to `targetUserId`, checked above
   *     by `isMarkerForUser`, so it cannot be forged or transplanted;
   *   - it is a COOKIE-LIFETIME exemption, not a grant. No `sam_2fa` cookie is
   *     ever written for the customer's user id, so nothing survives the exit.
   *     The moment the marker is cleared or its 60 minutes elapse, the
   *     customer's account is back to requiring a real code — including on
   *     this same browser.
   */
  // userId (not isAuthenticated) so TypeScript narrows it to string here.
  if (userId && !isTwoFactorExempt && !impersonation) {
    const token = request.cookies.get(TWO_FACTOR_COOKIE)?.value ?? null;
    const trusted = await verifyDeviceToken(token, userId);

    if (!trusted) {
      // APIs get JSON, never an HTML redirect — a client fetching data must see
      // a real error, not a login page body.
      if (isApiRoute) {
        return NextResponse.json({ error: 'two_factor_required' }, { status: 403 });
      }

      const url = request.nextUrl.clone();
      const intended = request.nextUrl.pathname + request.nextUrl.search;
      url.pathname = '/auth/verify-code';
      url.search = `?next=${encodeURIComponent(intended)}`;
      return NextResponse.redirect(url);
    }
  }

  /**
   * PAUSED ACCOUNT GATE
   *
   * An admin-paused company cannot reach ANY app page or customer API. It runs
   * after the 2FA gate so a paused user is not asked for a code on their way to
   * a page that only tells them they are paused.
   *
   * Only ONE query, and only for routes that could be blocked — admin routes,
   * auth pages and the paused page itself skip it entirely, so an admin
   * suspending an account never locks themselves out of the admin area.
   *
   * `is_paused` is honoured directly (not through evaluateAccess's elapsed
   * resume date), as before. Exception: a paused company with NO live Stripe
   * subscription may reach the purchase journey — buying a plan ends the
   * pause. See decideBillingGate.
   */
  /**
   * THE EXIT ENDPOINT IS EXEMPT FROM BOTH BILLING GATES.
   *
   * This was a real dead end, not a hypothetical one. An admin impersonates a
   * customer in order to look at a problem, and the most common problem is
   * that the account is locked out or paused. The gates below answer an API
   * request from such an account with 402 / 403 — and until now that included
   * POST /api/admin/impersonate/exit, because it is an API route and is in
   * neither `isAllowedWhileLockedOut` nor the paused allowance. The Exit
   * button, the account menu and /auth/impersonation-ended all POST that one
   * endpoint, so all three failed together for exactly the companies an admin
   * is most likely to be viewing.
   *
   * Exempting it weakens nothing. The gates exist to stop an unentitled
   * account USING the product; this endpoint ends a session. Its own
   * authorization is the signed httpOnly return ticket, it is already exempt
   * from the "/api/admin is blocked while impersonating" rule for the same
   * reason (IMPERSONATION_EXIT_PATH), and a caller without a ticket gets
   * signed out rather than let in.
   */
  const isImpersonationExitRoute = request.nextUrl.pathname === IMPERSONATION_EXIT_PATH;

  /**
   * ONBOARDING PAGES ARE CALL-GATED, THOUGH THEY ARE NOT APP ROUTES.
   *
   * `/onboarding/*` is excluded from `isAppRoute` (and from the 2FA gate) so a
   * brand-new user is not interrupted mid-questionnaire, which means this
   * block used to skip it entirely — and /onboarding/welcome is the post-signup
   * hub: it reads initiatives and writes a result through the BROWSER's
   * Supabase client, so a company awaiting its call could still use the
   * product there. The call gate's own tests already list /onboarding/welcome
   * among the routes it blocks; this is what makes that true in the request
   * path.
   *
   * The BILLING gates are deliberately NOT widened to these routes: whether an
   * unentitled user may walk the onboarding hub is a separate, pre-existing
   * decision, and changing it is not this feature's business. Only the call
   * gate is applied below, from `decideCallGate` — the same one rule the app
   * routes, the APIs, the thank-you page and the admin table use.
   */
  if (
    userId &&
    !isImpersonationExitRoute &&
    (isAppRoute || isOnboardingRoute || (isApiRoute && !isPublicApiRoute))
  ) {
    const { data: gateProfile } = await supabase
      .from('profiles')
      .select('company_id, is_admin, role')
      .eq('id', userId)
      .maybeSingle();

    /**
     * Super admins are never locked out — they are the people who undo it.
     *
     * NOTE ON IMPERSONATION (requirement 9): this needs no special case, and
     * deliberately has none. `is_admin` is read from the profile of whoever is
     * SIGNED IN, and during impersonation that is the customer's owner, whose
     * profile is not an admin. So an impersonating admin hits the pause and
     * entitlement gates exactly as the customer does — if the customer is
     * locked out, the admin sees the lockout screen. That is the point of
     * looking, and it is why impersonation is a real sign-in rather than an
     * id swap.
     */
    if (gateProfile?.company_id && !gateProfile.is_admin) {
      /**
       * ONE QUERY for both gates.
       *
       * Reading the pause flag and the entitlement columns together, because
       * this runs on the Edge for every request and a second round trip would
       * tax every page load.
       */
      /**
       * The subscription row and the company's call-gate columns, IN
       * PARALLEL.
       *
       * They are two tables, so they cannot be one query — but they can be one
       * round trip's worth of latency, which is what matters on the Edge. The
       * subscription read is unchanged.
       *
       * NOT FETCHED THROUGH `profiles` AS AN EMBED, which was the obvious way
       * to avoid the second request. Migration 043 is applied by hand, so
       * until it runs the embedded columns do not exist and the WHOLE select
       * fails — which would leave `gateProfile` null and skip the BILLING gate
       * for every customer. A separate query means a missing column costs the
       * call gate only.
       */
      const [subResult, companyResult] = await Promise.all([
        supabase
          .from('subscriptions')
          .select(
            'is_paused, pause_resumes_at, status, stripe_status, is_comped, ' +
            'comped_until, trial_ends_at, current_period_end, past_due_since, ' +
            'cancel_at_period_end, stripe_subscription_id, stripe_mode'
          )
          .eq('company_id', gateProfile.company_id)
          .maybeSingle(),
        supabase
          .from('companies')
          .select('created_at, requires_call_unlock, portal_access_granted_at')
          .eq('id', gateProfile.company_id)
          .maybeSingle(),
      ]);

      // Via `unknown`: supabase-js cannot infer a row shape from a
      // concatenated select string and falls back to an error-type union.
      const gateSub = subResult.data as unknown as GateSubRow | null;

      /**
       * THE CALL-GATE COLUMNS FAIL OPEN, ALWAYS.
       *
       * Before migration 043 is applied this select errors with 42703 and
       * there is nothing to read; afterwards it can still fail for the usual
       * transient reasons. Either way `gateCompany` is null, `decideCallGate`
       * reads null as "not gated", and the request proceeds — the billing
       * gate above is untouched by this.
       *
       * That direction is not a preference. Reading an error as "requires a
       * call" would lock every paying customer out of the product at once,
       * which is strictly worse than letting a company that should be waiting
       * through for one request. Same rule `loadBillingConfig` and
       * `loadCallGateSettings` follow.
       */
      let gateCompany: CallGateCompany | null = null;

      if (companyResult.error) {
        if (!isMissingColumnError(companyResult.error)) {
          // An unapplied migration is expected and silent; a real failure is
          // worth one line, because it means a gated company is getting in.
          console.warn(
            '[middleware] call-gate columns unreadable, not gating:',
            companyResult.error.message
          );
        }
      } else if (companyResult.data) {
        const row = companyResult.data as unknown as {
          created_at?: string | null;
          requires_call_unlock?: boolean | null;
          portal_access_granted_at?: string | null;
        };
        gateCompany = {
          requires_call_unlock: row.requires_call_unlock ?? null,
          portal_access_granted_at: row.portal_access_granted_at ?? null,
        };
      }

      /**
       * The paused, entitlement and onboarding-call decisions, as one tested
       * pure function (src/lib/billing/billing-gate.ts). The billing rules are
       * unchanged, including the one approved exception: a paused company with
       * NO live Stripe subscription may reach the purchase journey, because
       * buying a plan ends the pause (the webhook clears it). A paused company
       * with a live subscription is still refused everywhere.
       *
       * The call gate runs LAST — after 2FA (they must be able to prove who
       * they are before anything decides what they may see) and after billing.
       * `decideAccessGates` carries the argument for that order; the short
       * version is that the flag is stamped at company creation rather than at
       * payment, so "flagged" does not imply "paid", and a company with
       * nothing to its name should be sent to buy rather than to a thank-you
       * page that would bounce it to /choose-plan anyway.
       */
      /*
       * An onboarding page asks ONLY the call gate (see the note at the top of
       * this block), so it does not pay for the billing settings read either.
       */
      /*
       * THE GATE IS THE COMPANY'S; THE STAMP IS THE OWNER'S. While the portal
       * is closed nobody in the company gets in, teammates included (client,
       * Oct 2026). But only the owner's visit may flag an undecided company:
       * a teammate logging in must never close a company's portal (below).
       */
      const isCompanyOwner = (gateProfile as { role?: string | null }).role === 'owner';
      const gate: AccessGateDecision = isOnboardingRoute
        ? decideCallGate({
            isAdmin: false,
            company: gateCompany,
            pathname: request.nextUrl.pathname,
            method: request.method,
          }).blocked
          ? { kind: 'awaiting_call' }
          : { kind: 'pass' }
        : decideAccessGates({
            isAdmin: false,
            hasCompany: true,
            sub: gateSub,
            settings: await loadGateSettings(supabase),
            company: gateCompany,
            pathname: request.nextUrl.pathname,
            method: request.method,
          });

      if (gate.kind === 'paused') {
        // APIs get JSON. A client fetching data must see a real error rather
        // than the HTML of a login page.
        if (isApiRoute) {
          return NextResponse.json(
            {
              error: 'account_paused',
              message: 'This account is paused. Contact your administrator to continue.',
            },
            { status: 403 }
          );
        }

        const url = request.nextUrl.clone();
        url.pathname = '/account-paused';
        url.search = '';
        return NextResponse.redirect(url);
      }

      /**
       * ENTITLEMENT GATE — no plan, no product.
       *
       * Covers the three ways an account ends up with nothing: an expired
       * trial, a registration that abandoned Checkout, and a cancelled
       * subscription. Previously these only blocked API routes, so the
       * dashboard still rendered and an expired trial could keep building
       * plans indefinitely.
       *
       * The decision comes from `evaluateAccess`, the same function the API
       * enforcement path and the admin table use, so the three cannot
       * disagree about who is entitled.
       *
       * Settings is INTENTIONALLY blocked. Plan purchase moved to its own
       * route precisely so profile, team and notification settings could be
       * shut without taking the way out with them.
       *
       * Decided by decideBillingGate above (evaluateAccess + requiresPurchase
       * + isAllowedWhileLockedOut, unchanged).
       */
      if (gate.kind === 'purchase') {
        if (isApiRoute) {
          return NextResponse.json(
            {
              error: 'subscription_required',
              reason: gate.reason,
              message: 'This account needs an active plan to continue.',
            },
            { status: 402 }
          );
        }

        const url = request.nextUrl.clone();
        url.pathname = '/choose-plan';
        url.search = '';
        return NextResponse.redirect(url);
      }

      /**
       * ONBOARDING CALL GATE — paid, but nobody has spoken to them yet.
       *
       * They have an entitlement (the billing gate above said so), so this is
       * not a payment problem and must not read as one. A page goes to the
       * thank-you page, which carries the "Book a call with us" button; an API
       * gets 403 with a reason it can show, not a 402 that would send the
       * client off to buy something it already owns.
       *
       * NO LOOP IS POSSIBLE. /welcome is in `isPurchaseFlowRoute`, so it is
       * neither an app route nor an API route and this whole block is skipped
       * for it; `isAllowedWhileAwaitingCall` allows it as well, so the answer
       * is the same whichever way it is reached.
       *
       * WHAT THIS DELIBERATELY DOES NOT BLOCK: /choose-plan and /checkout.
       * Both are excluded from `isAppRoute`, so the gate is never consulted
       * there — and that is load-bearing rather than an oversight. The flag is
       * stamped when the COMPANY is created, which in the no-trial flow is
       * before Checkout; blocking the purchase journey would mean a flagged
       * company could never pay, and the gate is supposed to come after
       * payment. The allow-list in call-gate.ts is untouched.
       */
      if (gate.kind === 'awaiting_call') {
        if (isApiRoute) {
          return NextResponse.json(
            {
              error: 'awaiting_onboarding_call',
              message: CALL_GATE_BLOCKED_MESSAGE,
            },
            { status: 403 }
          );
        }

        const url = request.nextUrl.clone();
        url.pathname = CALL_GATE_PAGE;
        url.search = '';
        return NextResponse.redirect(url);
      }

      /**
       * BACKSTOP STAMP for a company the application never got to stamp.
       *
       * Public signup's company row is written by the `handle_new_user`
       * database trigger, which no application code runs inside, and the
       * confirmation link can land on /auth/confirmed as a hash fragment that
       * never reaches the server — so the obvious stamping points are missed
       * for some signups. The thank-you page stamps the paid flow with the
       * service role; this covers the trial flow, whose signup goes straight
       * to the dashboard and never passes /welcome at all.
       *
       * COSTS NOTHING ON AN ORDINARY REQUEST, which is the only reason it is
       * acceptable here (the Next docs are explicit that proxy/middleware is
       * not the place for data work). All four conditions are answered from
       * data already in hand:
       *
       *   - a PAGE navigation, not an API call and not a static asset (those
       *     never reach this block);
       *   - the company carries NO DECISION yet — flag false, no grant — so a
       *     gated or an unlocked company is never reconsidered;
       *   - (the old ten-minute age limit is gone, Oct 2026: every company
       *     without a decision is gated while the switch is on);
       *   - and only then is the global switch read.
       *
       * So the extra cost is confined to page requests from a company less
       * than ten minutes old: one `app_settings` read per navigation, plus (if
       * and only if the switch is on) the one company re-read and single
       * UPDATE that `stampCallUnlockForNewCompany` performs. Every long-lived
       * customer pays nothing.
       *
       * NEVER THROWS, never un-stamps and never re-locks a granted company —
       * guaranteed by `stampCallUnlockForNewCompany`, not by this call site.
       *
       * OWNER ONLY: a teammate's visit never stamps, so logging in as an
       * invited operator or viewer can never close a company's portal.
       */
      if (
        !isApiRoute &&
        isCompanyOwner &&
        gateCompany &&
        gateCompany.requires_call_unlock !== true &&
        !gateCompany.portal_access_granted_at
      ) {
        const stamp = await stampCallUnlockForNewCompany(supabase, gateProfile.company_id);

        /*
         * Honour the stamp on the SAME request that applied it.
         *
         * The gates above were decided from the row as it was a moment ago, so
         * without this the request that stamps is the one request that gets
         * through — a brand-new customer would see the dashboard once and find
         * it gone on their next click. We are here only for a page navigation
         * on an app or onboarding route, and neither is on the allow-list, so
         * the answer is unconditional.
         */
        if (stamp.stamped) {
          const url = request.nextUrl.clone();
          url.pathname = CALL_GATE_PAGE;
          url.search = '';
          return NextResponse.redirect(url);
        }
      }
    }
  }

  /**
   * A signed-in customer has no use for the marketing landing page.
   *
   * Sends them to the dashboard instead. Only the EXACT root is redirected —
   * /sample-plan and /admin-login stay reachable, since an admin may legitimately
   * want the admin sign-in page while holding a customer session.
   *
   * Runs after the paused gate, so a paused user lands on /account-paused
   * rather than being bounced to a dashboard they cannot use.
   */
  if (isAuthenticated && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/year-at-a-glance';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Onboarding requires an account. Send guests to SIGNUP (not login), since
  // the whole point of the new flow is that the account is created first.
  if (!isAuthenticated && isOnboardingRoute) {
    const url = request.nextUrl.clone();
    const intended = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = '/auth/signup';
    url.search = `?next=${encodeURIComponent(intended)}`;
    return NextResponse.redirect(url);
  }

  // If user is not logged in and trying to access a protected route
  if (!isAuthenticated && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }

  // If user is logged in and trying to access auth pages, redirect to app.
  //
  // EXCEPT for a link-only session: bouncing it into the app would immediately
  // hit the confinement block above and bounce it straight back to
  // /auth/set-password — a ping-pong that stranded users on the set-password
  // screen after they had already set their password. A link-only session must
  // be able to reach /auth/login so it can sign in for real.
  if (isAuthenticated && isAuthRoute && !isAuthFlowRoute && !isLinkOnlySession) {
    const url = request.nextUrl.clone();
    url.pathname = '/year-at-a-glance';
    return NextResponse.redirect(url);
  }

  // Admin route protection
  if (isAdminRoute && !request.nextUrl.pathname.startsWith('/admin/login') && !request.nextUrl.pathname.startsWith('/admin-login')) {
    // Same check as `!isAuthenticated`, written against `userId` directly so the
    // profile query below sees it as a non-null string.
    if (!userId) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin-login';
      return NextResponse.redirect(url);
    }

    // Check is_admin flag
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();

    if (!profile?.is_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin-login';
      return NextResponse.redirect(url);
    }

    // No 2FA check here any more — the universal gate above already required a
    // trusted device for /admin/* (and /api/admin/*). What remains in this
    // block is authorization: is_admin, not device trust.
  }

  return supabaseResponse;
}
