import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TWO_FACTOR_COOKIE, verifyDeviceToken } from '@/lib/two-factor';
import { evaluateAccess } from '@/lib/billing/entitlement';
import { requiresPurchase, isAllowedWhileLockedOut } from '@/lib/billing/lockout';

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
     * Whether signup must start with a plan choice. The signup page is reached
     * by ANONYMOUS visitors, so a 401 here would make the page unable to learn
     * the rule and it would fall back to skipping plan selection. Returns a
     * single boolean that the pricing page already discloses.
     */
    request.nextUrl.pathname === '/api/billing/signup-flow';
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
  const isAuthFlowRoute =
    request.nextUrl.pathname.startsWith('/auth/set-password') ||
    request.nextUrl.pathname.startsWith('/auth/reset-password') ||
    request.nextUrl.pathname.startsWith('/auth/verify-code');

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
   */
  if (isLinkOnlySession) {
    // APIs never get an HTML redirect. Only the exact /api/me endpoint is
    // allowed through (not /api/me/* — e.g. /api/me/password already demands
    // the current password and is not part of this flow).
    if (isApiRoute) {
      const isAllowedApi =
        request.nextUrl.pathname === '/api/me' || isPublicApiRoute;

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
  // userId (not isAuthenticated) so TypeScript narrows it to string here.
  if (userId && !isTwoFactorExempt) {
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
   * `is_paused` is read directly rather than through `evaluateAccess`: the
   * middleware runs on the Edge on every request, and loading billing settings
   * plus the full entitlement evaluation here would tax every page load. The
   * flag is a single boolean with one meaning, and the full evaluation still
   * runs server-side in the API routes that enforce limits.
   */
  if (userId && (isAppRoute || (isApiRoute && !isPublicApiRoute))) {
    const { data: gateProfile } = await supabase
      .from('profiles')
      .select('company_id, is_admin')
      .eq('id', userId)
      .maybeSingle();

    // Super admins are never locked out — they are the people who undo it.
    if (gateProfile?.company_id && !gateProfile.is_admin) {
      /**
       * ONE QUERY for both gates.
       *
       * Reading the pause flag and the entitlement columns together, because
       * this runs on the Edge for every request and a second round trip would
       * tax every page load.
       */
      const { data: gateSubRaw } = await supabase
        .from('subscriptions')
        .select(
          'is_paused, pause_resumes_at, status, stripe_status, is_comped, ' +
          'comped_until, trial_ends_at, current_period_end, past_due_since, ' +
          'cancel_at_period_end'
        )
        .eq('company_id', gateProfile.company_id)
        .maybeSingle();

      // Via `unknown`: supabase-js cannot infer a row shape from a
      // concatenated select string and falls back to an error-type union.
      const gateSub = gateSubRaw as unknown as {
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
      } | null;

      if (gateSub?.is_paused) {
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
       */
      const settings = await loadGateSettings(supabase);

      const access = evaluateAccess(
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
        }
      );

      if (
        !access.allowed &&
        requiresPurchase(access.reason) &&
        !isAllowedWhileLockedOut(request.nextUrl.pathname)
      ) {
        if (isApiRoute) {
          return NextResponse.json(
            {
              error: 'subscription_required',
              reason: access.reason,
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
