"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

/**
 * Landing page that ends an impersonation session and sends the admin home.
 *
 * WHY A PAGE EXISTS FOR THIS
 * --------------------------
 * The middleware can detect that an impersonation has expired (or that the
 * admin has wandered into /admin/* while still wearing the customer's
 * session), but it cannot FIX it: restoring the admin means exchanging a
 * refresh token with the auth server and rewriting session cookies, which is
 * a POST to a Node-runtime route, not something a redirect can do.
 *
 * So the middleware redirects here and this page performs the POST. It is the
 * one screen whose job is to make sure nobody stays signed in as a customer by
 * accident.
 *
 * A CLIENT page by necessity — it has to issue the request itself. It lives
 * under /auth so the universal 2FA gate already exempts it, and it is listed
 * in `isAuthFlowRoute` so an authenticated visitor is not bounced to the
 * dashboard before it can run.
 */
export default function ImpersonationEndedPage() {
  const [failed, setFailed] = useState(false);
  /*
   * React 19 StrictMode double-invokes effects in development. Exiting twice
   * would spend the return ticket, then fail on the second call and sign the
   * admin out — so the POST is fired at most once per mount.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/admin/impersonate/exit", { method: "POST" });
        const json: { redirectTo?: string } = await res.json().catch(() => ({}));
        // Full load, not a client navigation: the session cookies changed.
        window.location.href = json.redirectTo || "/admin/companies";
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div
        role="status"
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-card p-6 text-center"
      >
        {failed ? (
          <>
            <ShieldAlert className="mx-auto h-6 w-6 text-amber-500" aria-hidden="true" />
            <h1 className="mt-3 text-base font-semibold">Could not switch back</h1>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              Impersonation has ended. Please sign in again to return to your admin account.
            </p>
            <a
              href="/auth/login?notice=impersonation_ended"
              className="mt-4 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Go to sign in
            </a>
          </>
        ) : (
          <>
            <Loader2
              className="mx-auto h-6 w-6 animate-spin text-[hsl(var(--primary))]"
              aria-hidden="true"
            />
            <h1 className="mt-3 text-base font-semibold">Returning to your account…</h1>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              Ending the customer session and signing you back in as yourself.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
