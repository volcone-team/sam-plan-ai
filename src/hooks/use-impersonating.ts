'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { IMPERSONATION_MARKER_COOKIE } from '@/lib/admin/impersonation';

/**
 * Client-side view of "is a super admin currently signed in as this customer?"
 *
 * Reads the `sam_impersonating` marker cookie, which the start endpoint sets
 * non-httpOnly precisely so the UI can see it. It holds no credential — the
 * admin's refresh token is in a separate httpOnly cookie no script can read.
 *
 * FOR PRESENTATION ONLY. The signature is NOT checked here and does not need
 * to be: the middleware verifies it on every request and is what actually
 * grants or refuses anything. Hiding a button with this hook is a courtesy so
 * admins do not click into a 403; the control is server-side (see
 * `isBlockedWhileImpersonating`). Someone who hand-writes this cookie changes
 * what their own UI looks like and nothing else.
 */

export interface ImpersonationView {
  companyName: string;
  targetEmail: string;
  adminEmail: string;
  expiresAt: number;
}

/**
 * Raw cookie value, or "". A PRIMITIVE by necessity:
 * `useSyncExternalStore` compares snapshots by identity, so returning a fresh
 * object each render would loop forever.
 */
export function getMarkerCookie(): string {
  if (typeof document === 'undefined') return '';
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${IMPERSONATION_MARKER_COOKIE}=`))
      ?.slice(IMPERSONATION_MARKER_COOKIE.length + 1) ?? ''
  );
}

/**
 * No banner on the server. Rendering nothing server-side and letting the
 * client fill it in keeps hydration consistent, and avoids making every
 * customer page dynamic just to read a cookie that is almost never present.
 */
export function getServerMarkerCookie(): string {
  return '';
}

/** Cookies emit no change events; there is nothing to subscribe to. */
export function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * Decode the readable half of the marker.
 *
 * Shape is base64url(`purpose.json`) + "." + signature; we want the JSON.
 * Returns null on anything unexpected — a banner is not worth an exception.
 */
export function parseMarker(raw: string): ImpersonationView | null {
  if (!raw) return null;

  try {
    const body = decodeURIComponent(raw);
    const encoded = body.slice(0, body.lastIndexOf('.'));
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const text = decodeURIComponent(
      atob(padded)
        .split('')
        .map((ch) => `%${`00${ch.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );

    const json: unknown = JSON.parse(text.slice(text.indexOf('.') + 1));
    if (!json || typeof json !== 'object') return null;
    const m = json as Record<string, unknown>;

    if (typeof m.expiresAt !== 'number') return null;

    return {
      companyName: typeof m.companyName === 'string' ? m.companyName : 'this company',
      targetEmail: typeof m.targetEmail === 'string' ? m.targetEmail : 'the owner',
      adminEmail: typeof m.adminEmail === 'string' ? m.adminEmail : '',
      expiresAt: m.expiresAt,
    };
  } catch {
    return null;
  }
}

/** The decoded marker, or null when not impersonating. */
export function useImpersonationView(): ImpersonationView | null {
  const raw = useSyncExternalStore(
    subscribeToNothing,
    getMarkerCookie,
    getServerMarkerCookie
  );
  return useMemo(() => parseMarker(raw), [raw]);
}

/** Convenience boolean for hiding controls that the server will refuse. */
export function useIsImpersonating(): boolean {
  return useImpersonationView() !== null;
}
