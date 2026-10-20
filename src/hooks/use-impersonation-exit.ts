'use client';

import { useCallback, useState } from 'react';
import { cacheClearAll } from '@/lib/client-cache';

/**
 * The one way out of an impersonated session, shared by every control that
 * offers it.
 *
 * WHY THIS IS A HOOK AND NOT A METHOD ON ONE COMPONENT
 * ----------------------------------------------------
 * It used to live inside the banner. The banner then failed to render at all
 * (it decided whether to show itself by parsing the `sam_impersonating` cookie
 * in the browser, and the decoder split the payload on the first "." while the
 * purpose prefix `sam.impersonation.marker.v1` contains three — so JSON.parse
 * threw on every page and the component returned null). With the action
 * trapped inside the component, one cosmetic bug meant no way back to the
 * admin's own account at all.
 *
 * So the action is separate from anything that decides to display it, and it
 * is offered from more than one place: the banner, the account menu, and
 * /auth/impersonation-ended reachable by typing the URL.
 *
 * WHAT IT NEEDS TO WORK: nothing readable. The exit endpoint authorizes on
 * `sam_imp_return`, the httpOnly signed ticket holding the admin's refresh
 * token. No client-side state, no cookie the browser can read, and no correct
 * banner are required for this to succeed.
 */
export function useImpersonationExit(): {
  exit: () => Promise<void>;
  exiting: boolean;
} {
  const [exiting, setExiting] = useState(false);

  const exit = useCallback(async () => {
    setExiting(true);
    /*
     * Drop the cached /api/me and plan data first. It belongs to the CUSTOMER,
     * it lives in sessionStorage for 5 minutes, and the admin is about to be
     * restored in this same tab — so leaving it would show the admin the
     * customer's company on arrival.
     */
    cacheClearAll();
    try {
      const res = await fetch('/api/admin/impersonate/exit', { method: 'POST' });
      const json: { redirectTo?: string } = await res.json().catch(() => ({}));
      /*
       * A full page load, not router.push: the session cookies just changed
       * underneath the client, so every cached server component and client
       * cache entry belongs to the wrong user.
       */
      window.location.href = json.redirectTo || '/admin/companies';
    } catch {
      /*
       * Even a failed request must not leave them on a customer screen. The
       * landing page retries the POST and, failing that, offers sign-in —
       * which also ends the customer session.
       */
      window.location.href = '/auth/impersonation-ended?reason=exit_failed';
    }
  }, []);

  return { exit, exiting };
}
