'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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

    async function load() {
      try {
        const res = await fetch('/api/me');
        const json = await res.json();

        if (cancelled) return;

        if (!json.user) {
          setState({ ...initialState, loading: false });
          return;
        }

        const u = json.user;
        setState({
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
      } catch {
        if (!cancelled) setState({ ...initialState, loading: false });
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthState {
  return useContext(AuthContext);
}
