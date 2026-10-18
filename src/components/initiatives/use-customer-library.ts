'use client';

import { useEffect, useState } from 'react';
import type { CustomerLibraryItem } from '@/lib/library/picker';

export interface UseCustomerLibrary {
  initiatives: CustomerLibraryItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Every active library initiative, from GET /api/library/initiatives.
 *
 * Loaded the first time `enabled` is true (the panel opening) and kept for the
 * rest of the page's life: the library only changes on a workbook upload.
 */
export function useCustomerLibrary(enabled: boolean): UseCustomerLibrary {
  const [initiatives, setInitiatives] = useState<CustomerLibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-runs on every open until a load succeeds, so a failure retries next time.
  useEffect(() => {
    if (!enabled || initiatives !== null) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/library/initiatives', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load the initiative list (${response.status}).`);
        const data = (await response.json()) as { initiatives?: CustomerLibraryItem[] };
        if (cancelled) return;
        setInitiatives(data.initiatives ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, initiatives]);

  return {
    initiatives: initiatives ?? [],
    // Derived, not set in the effect: in flight while open, unloaded and not failed.
    loading: enabled && initiatives === null && error === null,
    error,
  };
}
