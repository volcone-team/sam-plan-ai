import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  // Refresh the session — this is the key operation
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes: redirect to login if not authenticated
  const isAuthRoute = request.nextUrl.pathname.startsWith('/auth');
  const isPublicRoute =
    request.nextUrl.pathname === '/' ||
    request.nextUrl.pathname.startsWith('/sample-plan') ||
    request.nextUrl.pathname.startsWith('/onboarding') ||
    request.nextUrl.pathname.startsWith('/admin-login');
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');
  const isAppRoute =
    !isAuthRoute && !isPublicRoute && !isAdminRoute;

  // If user is not logged in and trying to access a protected route
  if (!user && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }

  // If user is logged in and trying to access auth pages, redirect to app
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/year-at-a-glance';
    return NextResponse.redirect(url);
  }

  // Admin route protection
  if (isAdminRoute && !request.nextUrl.pathname.startsWith('/admin/login') && !request.nextUrl.pathname.startsWith('/admin-login')) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin-login';
      return NextResponse.redirect(url);
    }

    // Check is_admin flag
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin-login';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
