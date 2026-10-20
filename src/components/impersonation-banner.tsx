"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ShieldAlert, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useImpersonationExit } from "@/hooks/use-impersonation-exit";
import { isImpersonationBannerHiddenPath } from "@/lib/admin/impersonation-banner-routes";
import { decideBannerState } from "@/lib/admin/impersonation-session";

/**
 * Banner shown on EVERY page while a super admin is signed in as a customer.
 *
 * WHY IT READS /api/me AND NOT A COOKIE  (this is the bug that broke it twice)
 * ---------------------------------------------------------------------------
 * It used to decide whether to render by parsing the readable
 * `sam_impersonating` cookie in the browser. That decoder took everything
 * after the FIRST "." as JSON — but the signed payload is
 * `sam.impersonation.marker.v1.{...}`, whose purpose prefix contains three
 * dots. `JSON.parse` therefore threw on every single page, the catch returned
 * null, and the component rendered nothing. Moving the mount from the (app)
 * group to the root layout changed nothing because the mount was never the
 * problem.
 *
 * The signal now comes from the SERVER, over the `/api/me` call AuthProvider
 * already makes on every page, and it is keyed on the httpOnly return ticket
 * rather than the readable marker — so the thing that decides to show the way
 * out is the same thing that makes the way out work. A missing or unreadable
 * marker now degrades the banner's DETAIL (see `degraded`), and can no longer
 * hide it.
 *
 * WHERE IT IS MOUNTED
 * -------------------
 * The root layout (src/app/layout.tsx), not the (app) route group, so it also
 * covers /intake, /welcome, /choose-plan, /account-paused and /checkout, each
 * of which has its own layout. `/auth/*` is suppressed; see
 * impersonation-banner-routes.ts.
 *
 * IT IS NOT THE ONLY WAY OUT, BY DESIGN
 * -------------------------------------
 * The same action is in the account menu (header/user-avatar.tsx) and at
 * /auth/impersonation-ended, which can be typed into the address bar. One
 * broken component must never trap an admin in a customer's account again.
 *
 * ACCESSIBILITY
 * -------------
 * `role="status"` so a screen reader announces it on arrival, a real <button>
 * for Exit (keyboard-reachable in document order, visible focus ring), and the
 * countdown carries a text label rather than relying on position.
 *
 * WHY IT IS NOT STICKY
 * --------------------
 * It stays in the normal document flow, above the shell, so it pushes content
 * down instead of overlaying anything. Pinning it with `sticky top-0` loses:
 * three existing elements already own the top of the viewport — the app header
 * (`sticky top-0 z-30`), the mobile nav bar (`fixed top-0 z-40`) and the
 * sidebar (`fixed inset-y-0 z-40`). A banner parked over that strip would
 * permanently cover the breadcrumbs, the avatar and the mobile menu button.
 */

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ImpersonationBanner() {
  const { impersonation } = useAuth();
  const pathname = usePathname();
  const { exit, exiting } = useImpersonationExit();

  const [now, setNow] = useState<number>(() => Date.now());

  const state = decideBannerState({
    impersonation,
    pathname,
    hiddenPath: isImpersonationBannerHiddenPath(pathname),
    now,
  });

  /*
   * Primitives, not the state object, for the effect dependencies below:
   * `decideBannerState` returns a fresh object every render, so depending on
   * it would re-run the effects on every tick for no reason.
   */
  const ticking = state.show && state.showCountdown;
  const elapsed = state.show && state.elapsed;

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
   *
   * The timer only runs when there is a real deadline to count down to. With
   * an unreadable marker (`expiresAt === null`) there is no honest number to
   * show and nothing to auto-exit on, so it stands down rather than throwing
   * the admin out of a session that may have just begun. Same on /auth/*,
   * where an auto-exit would fire a redirect out from under a sign-in or
   * impersonation-ended flow that is already handling the session itself.
   */
  useEffect(() => {
    if (!ticking) return;

    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  useEffect(() => {
    if (elapsed && !exiting) void exit();
  }, [elapsed, exiting, exit]);

  if (!state.show) return null;

  const { view, showCountdown, remainingMs } = state;

  return (
    <div
      role="status"
      className="relative z-[70] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-600 bg-amber-500 px-4 py-2 text-sm text-white"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />

      <span className="text-center">
        {/*
          Written to answer the question the owner actually asked ("where is
          the exit to go back to admin?"): who you are right now, whose data
          you are writing to, and that the button ends it. "Viewing as" was too
          soft — it reads like a preview, and nothing said how to get back.
        */}
        You are signed in as{" "}
        <strong className="font-semibold">{view.targetEmail}</strong>{" "}
        (<strong className="font-semibold">{view.companyName}</strong>). Everything you do
        is saved to their account.{" "}
        {/*
          Said out loud because billing is deliberately NOT blocked while
          impersonating (owner's decision). An admin clicking through a plan
          change here moves real money on a real card, and the one thing worse
          than not being able to do it is doing it by accident.
        */}
        <span className="font-semibold underline decoration-white/50">
          Billing actions are real and will charge or change their subscription.
        </span>
        {view.degraded && (
          /*
            LOUD, not silent. We know an impersonation is in progress (the
            return ticket is here) but the marker could not be read, so the
            company name and the countdown above are placeholders. Saying so
            beats showing "this company" as if it were a fact — and the Exit
            button still works, because it needs only the ticket.
          */
          <span className="block text-xs font-normal text-amber-50">
            Session details could not be read, so the account shown may be
            incomplete. Exit still works.
          </span>
        )}
      </span>

      {showCountdown && remainingMs !== null && (
        <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium tabular-nums">
          {remainingMs > 0 ? `Ends in ${formatRemaining(remainingMs)}` : "Ending…"}
        </span>
      )}

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
        {exiting ? "Exiting…" : "Exit to admin"}
      </button>
    </div>
  );
}
