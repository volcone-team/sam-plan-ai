'use client';

import { useEffect, useState } from 'react';
import { interpretPickerResponse, type PickerLoad } from './intake-picker-view';

/**
 * GET /api/intake-v3/picker, interpreted. Null until it settles.
 *
 * Loaded the first time `enabled` is true (the panel opening) and kept for the
 * rest of the page's life, failure included. A failure is NOT retried on the
 * next open: the panel decides its flow from this, and a retry landing while
 * someone is filling in the fallback form would swap the form under them.
 */
export function useIntakePickerLoad(enabled: boolean): PickerLoad | null {
  const [load, setLoad] = useState<PickerLoad | null>(null);
  const [started, setStarted] = useState(false);

  // Latch the first open during render (allowed for state derived from props).
  if (enabled && !started) setStarted(true);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    (async () => {
      let result: PickerLoad;
      try {
        const response = await fetch('/api/intake-v3/picker', { cache: 'no-store' });
        const body: unknown = await response.json().catch(() => undefined);
        result = interpretPickerResponse(response.status, body);
      } catch {
        result = interpretPickerResponse(null, undefined);
      }
      if (!cancelled) setLoad(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [started]);

  return load;
}
