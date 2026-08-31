'use client';

import { useAuthContext, type AuthState } from '@/components/auth-provider';

/**
 * Hook to get the authenticated user's company ID and profile info.
 * Reads from the shared AuthProvider context (single fetch per session)
 * instead of querying Supabase on every component mount.
 */
export function useAuth(): AuthState {
  return useAuthContext();
}

/**
 * Simple hook that just returns companyId (convenience wrapper).
 * Returns impersonated company ID if admin is impersonating.
 */
export function useCompanyId(): string | null {
  const { companyId } = useAuthContext();
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('sam-admin-impersonate');
      if (stored) {
        const { id } = JSON.parse(stored);
        if (id) return id;
      }
    } catch {}
  }
  return companyId;
}
