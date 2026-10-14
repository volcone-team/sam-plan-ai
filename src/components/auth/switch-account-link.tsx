"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * "Sign in with a different account" — signs out FIRST, then goes to login.
 *
 * WHY THIS IS NOT A LINK. It used to be a plain <Link href="/auth/login">,
 * which did nothing useful: the session was still valid, so the user arrived
 * signed in, and the lockout gate sent them straight back to the page they
 * were trying to escape. From their side the link was simply broken.
 *
 * `scope: "local"` matches every other sign-out in the app except account
 * deletion. Someone switching accounts on this browser must not have their
 * sessions on other devices terminated as a side effect.
 *
 * `window.location.assign` rather than router.push, for the same reason as
 * choose-plan: a full document load is what guarantees the middleware re-reads
 * the now-absent cookies. A client-side navigation can be served from the
 * router cache with the old session still assumed, which puts the user back
 * into the redirect loop this component exists to break.
 */
export function SwitchAccountLink({
  className,
  children = "Sign in with a different account",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  const switchAccount = async () => {
    if (busy) return;
    setBusy(true);

    try {
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      /*
       * Redirect anyway. A failed sign-out leaves them on the login page still
       * authenticated, which is recoverable; leaving them stranded on a page
       * with no way out is not.
       */
    }

    window.location.assign("/auth/login");
  };

  return (
    <button
      type="button"
      onClick={switchAccount}
      disabled={busy}
      className={
        className ??
        "inline-flex items-center gap-1.5 underline underline-offset-2 transition-colors hover:text-[hsl(var(--foreground-muted))] disabled:opacity-60"
      }
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      {busy ? "Signing out…" : children}
    </button>
  );
}
