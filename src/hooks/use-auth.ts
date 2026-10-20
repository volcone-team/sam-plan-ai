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
 *
 * Always the SESSION's company, with no override.
 *
 * This used to consult a `sam-admin-impersonate` sessionStorage key and return
 * the impersonated company id instead. That was the impersonation bug: it
 * changed which company CLIENT code read, while the admin's actual session
 * stayed their own. Server routes therefore still acted as the admin — the
 * Profile screen showed the admin, and starting an intake wrote to the ADMIN's
 * company — and because RLS on `initiatives`, `products`, `results` and
 * `annual_plans` is company-scoped with no admin read policy, the admin's own
 * JWT could not read the customer rows the screen was asking for anyway.
 *
 * Impersonation is now a real sign-in as the company's owner
 * (/api/admin/impersonate), so the session's own company id is already the
 * right answer and there is nothing to override.
 */
export function useCompanyId(): string | null {
  const { companyId } = useAuthContext();
  return companyId;
}
