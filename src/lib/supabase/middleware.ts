import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TWO_FACTOR_COOKIE, verifyDeviceToken } from '@/lib/two-factor';

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
  const isLinkOnlySession = isAuthenticated && authMethod !== null && authMethod !== 'password';

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
    request.nextUrl.pathname.startsWith('/api/notifications/unsubscribe');
  // Onboarding is NO LONGER public. The flow is account-first:
  //   Landing -> "Create an Account" -> /auth/signup -> /onboarding/welcome
  // Leaving /onboarding open let anyone walk the questionnaire with no account,
  // and let Back out of the questionnaire escape the flow entirely.
  const isOnboardingRoute = request.nextUrl.pathname.startsWith('/onboarding');
  const isPublicRoute =
    request.nextUrl.pathname === '/' ||
    request.nextUrl.pathname.startsWith('/sample-plan') ||
    request.nextUrl.pathname.startsWith('/admin-login');
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');
  const isAppRoute =
    !isAuthRoute && !isApiRoute && !isPublicRoute && !isAdminRoute && !isOnboardingRoute;

  // Some auth pages must stay reachable EVEN with a session:
  //  - Password-setting pages: an invite or recovery link signs the user in
  //    first (that's how they're authorized to set a password), so bouncing
  //    authenticated users away made it impossible to finish the flow.
  //  - The two-factor challenge: an admin reaching it ALWAYS holds a session
  //    by definition, and the admin gate below redirects here. Bouncing them
  //    away would make the 2FA gate an infinite loop.
  const isAuthFlowRoute =
    request.nextUrl.pathname.startsWith('/auth/set-password') ||
    request.nextUrl.pathname.startsWith('/auth/reset-password') ||
    request.nextUrl.pathname.startsWith('/auth/verify-code');

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
    // profile query and 2FA check below see it as a non-null string.
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

    // Confirmed admin — now require a trusted device. The `sam_2fa` cookie is
    // the only proof this device passed the emailed code challenge; it carries
    // its own HMAC + issue timestamp, so no extra DB lookup is needed here (we
    // reuse the `profile` row fetched above).
    const twoFactorToken = request.cookies.get(TWO_FACTOR_COOKIE)?.value ?? null;
    const trusted = await verifyDeviceToken(twoFactorToken, userId);

    if (!trusted) {
      const url = request.nextUrl.clone();
      const intended = request.nextUrl.pathname + request.nextUrl.search;
      url.pathname = '/auth/verify-code';
      url.search = `?next=${encodeURIComponent(intended)}`;
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
