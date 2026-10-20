'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cacheGet, cacheSet, cacheClearAll, CacheKeys, TTL } from '@/lib/client-cache';
import { createClient } from '@/lib/supabase/client';
import type { ImpersonationView } from '@/lib/admin/impersonation-session';

export interface AuthState {
  companyId: string | null;
  userId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  isAdmin: boolean;
  adminLevel: string | null;
  isActive: boolean;
  /** True when the user is signed in but has no profile row. */
  profileMissing: boolean;
  /**
   * Set when a super admin is signed in AS this user, read server-side by
   * /api/me from the signed impersonation cookies.
   *
   * NOT CACHED, deliberately. Everything else here is served from
   * sessionStorage for 5 minutes, which is right for a profile and wrong for
   * this: impersonation starts and ends with a full page load in the SAME tab,
   * so a cached value is the previous session's answer. It is populated only
   * from a live /api/me response, which is also why `load()` now runs on every
   * mount instead of only on a stale cache.
   */
  impersonation: ImpersonationView | null;
  loading: boolean;
}

const initialState: AuthState = {
  companyId: null,
  userId: null,
  email: null,
  firstName: null,
  lastName: null,
  role: null,
  isAdmin: false,
  adminLevel: null,
  isActive: true,
  profileMissing: false,
  impersonation: null,
  loading: true,
};

const AuthContext = createContext<AuthState>(initialState);

/** The `user` half of GET /api/me. Every field is optional on the wire. */
interface MeUser {
  id?: string | null;
  email?: string | null;
  companyId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  isActive?: boolean;
  isAdmin?: boolean;
  adminLevel?: string | null;
  profileMissing?: boolean;
}

interface MeResponse {
  user?: MeUser | null;
  impersonation?: ImpersonationView | null;
}

/**
 * Fetches the signed-in user's profile ONCE via /api/me and shares it
 * through context. Two deliberate properties:
 *
 *  1. Single fetch per session (previously every component re-queried
 *     Supabase on mount, which made pages slow).
 *  2. No cross-company fallback. If the profile cannot be read we leave
 *     companyId null rather than pointing the user at a different company.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let cancelled = false;

    const toState = (
      u: MeUser,
      impersonation: ImpersonationView | null
    ): AuthState => ({
      companyId: u.companyId ?? null,
      userId: u.id ?? null,
      email: u.email ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      role: u.role ?? null,
      isAdmin: !!u.isAdmin,
      adminLevel: u.adminLevel ?? null,
      isActive: u.isActive !== false,
      profileMissing: !!u.profileMissing,
      impersonation,
      loading: false,
    });

    // 1. Serve from cache immediately so companyId is available on the first
    //    render. /api/me costs ~1.9s (three sequential round trips), and it
    //    previously gated every data fetch on every navigation.
    //
    //    `impersonation: null` on this path: the cache cannot answer that
    //    question (see the field's note), so the first paint of an
    //    impersonated page has no banner and the response below adds it.
    const cached = cacheGet<MeUser>(CacheKeys.me, TTL.profile);
    if (cached) {
      setState(toState(cached.value, null));
    }

    async function load() {
      try {
        const res = await fetch('/api/me');
        const json: MeResponse = await res.json();
        const impersonation = json.impersonation ?? null;

        if (cancelled) return;

        if (!json.user) {
          // Still surface impersonation: a stranded admin needs the Exit
          // button even when the customer's session has gone.
          setState({ ...initialState, impersonation, loading: false });
          return;
        }

        cacheSet(CacheKeys.me, json.user);
        setState(toState(json.user, impersonation));
      } catch {
        // Keep showing cached data on network failure rather than blanking out.
        if (!cancelled && !cached) setState({ ...initialState, loading: false });
      }
    }

    /**
     * ALWAYS revalidate, even when the cache is fresh.
     *
     * It used to be `if (!cached || cached.stale) load()`. That is fine for a
     * profile and wrong for impersonation: the cache lives in sessionStorage
     * and impersonation both starts and ends with a full reload in the same
     * tab, so for up to 5 minutes a fresh cache entry would answer with the
     * PREVIOUS session's state — exactly long enough to hide the Exit button
     * from an admin who just arrived. Rendering still happens from the cache
     * first (above), so this is a background correction and gates nothing.
     */
    load();

    // React to auth changes.
    //
    // Without this, signing in via router.push() left this provider mounted
    // with its one-shot fetch already done, so companyId stayed null and any
    // page gated on it spun forever until a manual refresh.
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      console.log('[AuthProvider] auth event:', event);

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Profile may belong to a different user than any cached copy.
        cacheClearAll();
        load();
        return;
      }

      if (event === 'SIGNED_OUT') {
        cacheClearAll();
        setState({ ...initialState, loading: false });
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthState {
  return useContext(AuthContext);
}
