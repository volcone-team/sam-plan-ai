/**
 * "Is an impersonation in progress, and what should the UI say about it?"
 *
 * Pure. The caller does the cookie reading and signature verification
 * (`/api/me`); this decides what the client is told.
 *
 * WHY THE RETURN TICKET IS THE AUTHORITATIVE SIGNAL
 * -------------------------------------------------
 * The readable marker USED to be the only signal, and a bug in how the client
 * decoded it meant the banner — the only way back to the admin's own account —
 * rendered nothing on every page. See the note in `use-impersonation-exit.ts`.
 *
 * The lesson is structural, not textual: the thing that decides whether to
 * offer the way OUT must be the same thing that makes the way out possible.
 * That is `sam_imp_return`, the httpOnly ticket holding the admin's refresh
 * token — the exit endpoint needs nothing else. So:
 *
 *   ticket present  -> an impersonation IS in progress, say so
 *   marker present  -> fill in the names and the countdown
 *   marker missing, unreadable, or for someone else -> still say so, with
 *                      placeholders, because a cosmetic failure must never
 *                      hide the Exit button
 *
 * The reverse (marker without ticket) reports NOTHING. A marker alone cannot
 * be exited from, and offering a dead button is worse than offering none; the
 * middleware independently refuses to honour a marker the session does not
 * own, so nothing is granted by ignoring it here.
 */

import type { ImpersonationMarker, ImpersonationReturn } from './impersonation';

export interface ImpersonationView {
  /** Company whose data is on screen. "this company" when unknown. */
  companyName: string;
  /** Whose session is in use. "the owner" when unknown. */
  targetEmail: string;
  /** The admin who started it. "" when unknown. */
  adminEmail: string;
  /**
   * Epoch ms, or null when the marker could not be read.
   *
   * NULL IS MEANINGFUL: the banner hides the countdown and does not auto-exit,
   * rather than inventing a deadline and throwing the admin out of a session
   * that may have just started. The middleware still enforces the real limit
   * from the signed marker on the next request.
   */
  expiresAt: number | null;
  /**
   * True when the ticket is present but the marker is not usable. The banner
   * says so out loud instead of quietly showing placeholders, because it also
   * means the countdown and the company name cannot be trusted.
   */
  degraded: boolean;
}

export function resolveImpersonationView(args: {
  /** Verified return ticket, or null. */
  ticket: ImpersonationReturn | null;
  /** Verified marker, or null when absent/unsigned/malformed. */
  marker: ImpersonationMarker | null;
  /**
   * The signed-in user id, when known. Used only to decide whether the
   * marker's DISPLAY detail belongs to this session — never to decide whether
   * to show the banner at all.
   */
  sessionUserId?: string | null;
}): ImpersonationView | null {
  const { ticket, marker, sessionUserId } = args;

  if (!ticket) return null;

  /*
   * A marker naming a different user is stale (a previous impersonation in
   * this browser). Its company name and countdown would be a lie, so it is
   * treated as unusable — but the banner still appears, degraded.
   */
  const usable =
    marker !== null &&
    (!sessionUserId || marker.targetUserId === sessionUserId);

  if (!usable) {
    return {
      companyName: 'this company',
      targetEmail: 'the owner',
      adminEmail: ticket.adminEmail,
      expiresAt: null,
      degraded: true,
    };
  }

  return {
    companyName: marker.companyName || 'this company',
    targetEmail: marker.targetEmail || 'the owner',
    adminEmail: marker.adminEmail || ticket.adminEmail,
    expiresAt: marker.expiresAt,
    degraded: false,
  };
}

/* ------------------------------------------------------------------ banner */

export type BannerState =
  | { show: false }
  | {
      show: true;
      view: ImpersonationView;
      /** Render the countdown chip? Only when a deadline is actually known. */
      showCountdown: boolean;
      /** Milliseconds left, or null when unknown. */
      remainingMs: number | null;
      /** Has the window elapsed? The banner auto-exits on this. */
      elapsed: boolean;
    };

/**
 * What the banner should render. Pure, so "the banner appears from the
 * /api/me signal with no cookie readable at all" is a unit test rather than a
 * browser experiment.
 */
export function decideBannerState(args: {
  impersonation: ImpersonationView | null;
  /** Current pathname; `/auth/*` suppresses the banner. */
  pathname: string | null;
  hiddenPath: boolean;
  now: number;
}): BannerState {
  const { impersonation, hiddenPath, now } = args;

  if (!impersonation || hiddenPath) return { show: false };

  const expiresAt = impersonation.expiresAt;

  if (expiresAt === null) {
    // No trustworthy deadline: show the banner and the Exit button, no clock,
    // and never auto-exit on a number we do not have.
    return {
      show: true,
      view: impersonation,
      showCountdown: false,
      remainingMs: null,
      elapsed: false,
    };
  }

  return {
    show: true,
    view: impersonation,
    showCountdown: true,
    remainingMs: Math.max(0, expiresAt - now),
    elapsed: expiresAt <= now,
  };
}
