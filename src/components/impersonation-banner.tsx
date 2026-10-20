"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, LogOut, Loader2 } from "lucide-react";
import { useImpersonationView } from "@/hooks/use-impersonating";

/**
 * Banner shown on every app page while a super admin is signed in as a
 * customer.
 *
 * WHY IT READS A COOKIE AND NOT A CONTEXT
 * ---------------------------------------
 * The previous version read a React context backed by `sessionStorage`, which
 * was also the (broken) impersonation mechanism itself. Now the server owns the
 * state: `sam_impersonating` is set by /api/admin/impersonate, is HMAC-signed,
 * and is deliberately NOT httpOnly so this component can render from it
 * without an extra round trip. It carries no credential — the admin's refresh
 * token lives in a separate httpOnly cookie this code cannot see.
 *
 * The signature is NOT verified here, and does not need to be: the middleware
 * verifies it on every request and is what actually grants anything. A user who
 * hand-crafts this cookie gains a misleading banner and nothing else.
 *
 * ACCESSIBILITY
 * -------------
 * `role="status"` so a screen reader announces it on arrival, a real <button>
 * for Exit (keyboard-reachable in document order, visible focus ring), and the
 * countdown carries a text label rather than relying on position. The banner is
 * in the normal flow at the top of the layout, above the shell, so it pushes
 * content down instead of overlaying the sidebar or covering controls.
 */

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ImpersonationBanner() {
  const marker = useImpersonationView();

  const [now, setNow] = useState<number>(() => Date.now());
  const [exiting, setExiting] = useState(false);

  const exit = useCallback(async () => {
    setExiting(true);
    try {
      const res = await fetch("/api/admin/impersonate/exit", { method: "POST" });
      const json: { redirectTo?: string } = await res.json().catch(() => ({}));
      /*
       * A full page load, not router.push: the session cookies just changed
       * underneath the client, so every cached server component and client
       * cache entry belongs to the wrong user.
       */
      window.location.href = json.redirectTo || "/admin/companies";
    } catch {
      // Even a failed request must not leave them stuck on a customer screen.
      window.location.href = "/auth/impersonation-ended?reason=exit_failed";
    }
  }, []);

  /*
   * One timer, two jobs: drive the countdown, and AUTO-EXIT at the 60-minute
   * limit. The middleware also refuses an expired marker, but it can only act
   * on the next request — an admin sitting on a static page would otherwise
   * keep the customer's session open indefinitely.
   *
   * Both happen in the interval CALLBACK rather than in the effect body. That
   * is not incidental styling: setState during an effect body triggers
   * cascading renders (and the lint rule that forbids it), whereas a timer
   * firing is exactly the "external system notifies React" case effects are
   * for.
   */
  useEffect(() => {
    if (!marker) return;

    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);

      if (marker.expiresAt <= tick) {
        clearInterval(id);
        void exit();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [marker, exit]);

  if (!marker) return null;

  const remaining = marker.expiresAt - now;

  return (
    <div
      role="status"
      className="relative z-[70] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-600 bg-amber-500 px-4 py-2 text-sm text-white"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />

      <span className="text-center">
        Viewing as <strong className="font-semibold">{marker.companyName}</strong> as{" "}
        <strong className="font-semibold">{marker.targetEmail}</strong>. Changes you make are
        saved to their account.{" "}
        {/*
          Said out loud because billing is deliberately NOT blocked while
          impersonating (owner's decision). An admin clicking through a plan
          change here moves real money on a real card, and the one thing worse
          than not being able to do it is doing it by accident.
        */}
        <span className="font-semibold underline decoration-white/50">
          Billing actions are real and will charge or change their subscription.
        </span>
      </span>

      <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium tabular-nums">
        {remaining > 0 ? `Ends in ${formatRemaining(remaining)}` : "Ending…"}
      </span>

      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
      >
        {exiting ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="h-3 w-3" aria-hidden="true" />
        )}
        {exiting ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
