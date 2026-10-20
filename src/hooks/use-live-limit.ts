'use client';

import { useEffect, useState } from 'react';

export interface LiveLimitStatus {
  /** null while loading, when unlimited, or when not enforced. */
  limit: number | null;
  used: number;
  planName: string | null;
  loading: boolean;
}

/**
 * A live plan limit (`max_products`, `max_users`) for the caller's company,
 * from GET /api/billing/limits.
 *
 * For screens that cap input BEFORE the server would refuse it. A courtesy
 * only: every create path re-checks. A failed read leaves the screen uncapped
 * rather than blocking it.
 */
export function useLiveLimit(key: 'max_products' | 'max_users'): LiveLimitStatus {
  const [status, setStatus] = useState<LiveLimitStatus>({
    limit: null,
    used: 0,
    planName: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/limits', { cache: 'no-store' });
        const body = (await res.json().catch(() => null)) as {
          planName?: string | null;
          limits?: Record<string, { limit: number | null; used: number }>;
        } | null;
        if (cancelled) return;
        const entry = res.ok ? body?.limits?.[key] : undefined;
        setStatus({
          limit: typeof entry?.limit === 'number' ? entry.limit : null,
          used: typeof entry?.used === 'number' ? entry.used : 0,
          planName: body?.planName ?? null,
          loading: false,
        });
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return status;
}
