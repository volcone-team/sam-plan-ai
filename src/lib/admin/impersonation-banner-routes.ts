/**
 * Where the impersonation banner is NOT shown.
 *
 * The banner is mounted in the ROOT layout so it reaches every page — the app
 * group, /intake, /welcome, /choose-plan, /account-paused, /checkout and
 * anything added later. A super admin who started an intake while impersonating
 * previously saw no notice and had no way back, because the mount lived in the
 * (app) route group only.
 *
 * `/auth/*` is the one exception. Those are sign-in, confirmation and recovery
 * flows, and the page that ENDS impersonation lives there
 * (/auth/impersonation-ended). A banner offering "Exit to admin" on top of a
 * screen whose whole job is exiting is noise at best and contradictory at
 * worst, so it is suppressed for the whole prefix rather than page by page.
 *
 * This is presentation only. It hides a notice; it grants and refuses nothing.
 * The marker cookie and the middleware remain the source of truth.
 */
const HIDDEN_PREFIXES: readonly string[] = ['/auth'];

/**
 * @param pathname URL pathname, no query string. Empty/unknown counts as
 *   visible: a missing pathname must never be the reason an admin loses the
 *   only way back to their own account.
 */
export function isImpersonationBannerHiddenPath(pathname: string | null): boolean {
  if (!pathname) return false;

  return HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
