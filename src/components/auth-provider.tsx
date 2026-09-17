'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cacheGet, cacheSet, cacheClearAll, CacheKeys, TTL } from '@/lib/client-cache';
import { createClient } from '@/lib/supabase/client';

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
  loading: true,
};

const AuthContext = createContext<AuthState>(initialState);

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

    const toState = (u: any): AuthState => ({
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
      loading: false,
    });

    // 1. Serve from cache immediately so companyId is available on the first
    //    render. /api/me costs ~1.9s (three sequential round trips), and it
    //    previously gated every data fetch on every navigation.
    const cached = cacheGet<any>(CacheKeys.me, TTL.profile);
    if (cached) {
      setState(toState(cached.value));
    }

    async function load() {
      try {
        const res = await fetch('/api/me');
        const json = await res.json();

        if (cancelled) return;

        if (!json.user) {
          setState({ ...initialState, loading: false });
          return;
        }

        cacheSet(CacheKeys.me, json.user);
        setState(toState(json.user));
      } catch {
        // Keep showing cached data on network failure rather than blanking out.
        if (!cancelled && !cached) setState({ ...initialState, loading: false });
      }
    }

    // Only hit the network on mount when the cached copy is missing or stale.
    if (!cached || cached.stale) load();

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
