'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AuthState {
  companyId: string | null;
  userId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  loading: boolean;
}

/**
 * Hook to get the authenticated user's company ID and profile info.
 * Queries the profiles table using the current auth session.
 * Falls back to the COMPANY_ID constant if not authenticated.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    companyId: null,
    userId: null,
    email: null,
    firstName: null,
    lastName: null,
    loading: true,
  });

  useEffect(() => {
    const supabase = createClient();

    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        // Helper: extract a first name from metadata or email prefix
        const extractFirst = (u: typeof user) => {
          if (!u) return null;
          const meta = u.user_metadata || {};
          return meta.first_name || meta.firstName || meta.name?.split(' ')[0] || null;
        };
        const extractLast = (u: typeof user) => {
          if (!u) return null;
          const meta = u.user_metadata || {};
          return meta.last_name || meta.lastName || meta.name?.split(' ').slice(1).join(' ') || null;
        };

        if (!user) {
          // Not logged in — use fallback constant
          const { COMPANY_ID } = await import('@/lib/constants');
          setState({
            companyId: COMPANY_ID,
            userId: null,
            email: null,
            firstName: null,
            lastName: null,
            loading: false,
          });
          return;
        }

        // Get profile with company_id
        const { data: profile } = await supabase
          .from('profiles')
          .select('company_id, first_name, last_name')
          .eq('id', user.id)
          .single();

        if (profile) {
          setState({
            companyId: profile.company_id,
            userId: user.id,
            email: user.email || null,
            firstName: profile.first_name || extractFirst(user),
            lastName: profile.last_name || extractLast(user),
            loading: false,
          });
        } else {
          // Profile not found — fallback
          const { COMPANY_ID } = await import('@/lib/constants');
          setState({
            companyId: COMPANY_ID,
            userId: user.id,
            email: user.email || null,
            firstName: extractFirst(user),
            lastName: extractLast(user),
            loading: false,
          });
        }
      } catch {
        const { COMPANY_ID } = await import('@/lib/constants');
        setState(prev => ({ ...prev, companyId: COMPANY_ID, loading: false }));
      }
    }

    loadProfile();
  }, []);

  return state;
}

/**
 * Simple hook that just returns companyId (convenience wrapper).
 */
export function useCompanyId(): string | null {
  const { companyId } = useAuth();
  return companyId;
}
