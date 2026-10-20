/**
 * Admin impersonation — signed cookies and validity rules.
 *
 * WHAT THIS REPLACES
 * ------------------
 * The old mechanism was a `sessionStorage` key (`sam-admin-impersonate`) read
 * by `useCompanyId()`. It swapped the company id used by CLIENT reads while
 * leaving the admin's actual session untouched, so server routes still acted
 * as the admin, writes landed in the ADMIN's company, and RLS (which is
 * company-scoped with no admin read policy on `initiatives`, `products`,
 * `results`, `annual_plans`, ...) refused to return the data the screen asked
 * for. It is deleted.
 *
 * The replacement is a REAL sign-in as the target company's owner, so every
 * screen, RLS policy, server route and write behaves exactly as it does for
 * that customer. Two cookies carry the state.
 *
 * TWO COOKIES, TWO JOBS
 * ---------------------
 * 1. `sam_imp_return` (httpOnly) — the admin's way back: their refresh token
 *    and user id. httpOnly so no script can read it, signed so it cannot be
 *    swapped for someone else's.
 *
 * 2. `sam_impersonating` (readable) — the marker: who is acting as whom, and
 *    until when. Readable by design, because the banner renders from it and it
 *    carries no credential.
 *
 * WHY THE READABLE MARKER IS STILL SIGNED
 * ---------------------------------------
 * LOAD-BEARING. The middleware treats a valid marker as satisfying the
 * universal 2FA gate (see `src/lib/supabase/middleware.ts`), because an
 * impersonated session must never email a code to the customer. An UNSIGNED
 * marker would therefore be a complete 2FA bypass: any user could set
 * `sam_impersonating` in their own browser and walk past the challenge. So the
 * marker is HMAC-signed and bound to `targetUserId`, and the middleware only
 * honours it when that id equals the id of the session actually presenting it.
 * Signing protects integrity, not secrecy — there is nothing secret in it.
 *
 * EDGE RUNTIME
 * ------------
 * This module is imported by middleware, which runs on the Edge: no
 * `node:crypto`, no `Buffer`. Everything uses Web Crypto and hand-rolled
 * base64url, the same constraint `src/lib/two-factor.ts` works under.
 *
 * SECRET
 * ------
 * `TWO_FACTOR_SECRET`, reused deliberately rather than adding a new env var.
 * It is already the Edge-side signing secret for the device-trust cookie this
 * feature interacts with, so there is one secret to configure and rotate for
 * the whole middleware auth surface. Domain separation comes from a version +
 * purpose prefix inside each payload, so a device-trust token can never be
 * replayed as an impersonation marker (or vice versa).
 */

export const IMPERSONATION_RETURN_COOKIE = 'sam_imp_return';
export const IMPERSONATION_MARKER_COOKIE = 'sam_impersonating';

/** Hard time limit on an impersonation session: 60 minutes. */
export const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60;

/**
 * Purpose prefixes. These are what stop one signed blob being accepted where
 * another is expected, even though both are signed with the same key.
 */
const MARKER_PURPOSE = 'sam.impersonation.marker.v1';
const RETURN_PURPOSE = 'sam.impersonation.return.v1';

function getSecret(): string {
  const secret = process.env.TWO_FACTOR_SECRET;
  if (!secret) {
    throw new Error(
      'TWO_FACTOR_SECRET is not set. Add it to your environment before using admin impersonation.'
    );
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeText(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function decodeText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function hmac(payload: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

/** Length-independent, early-exit-free comparison of two ASCII strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Sign an arbitrary JSON payload under a purpose prefix.
 * Shape: base64url(`${purpose}.${json}`) + "." + base64url(HMAC_SHA256)
 */
async function signPayload(purpose: string, value: unknown): Promise<string> {
  const body = `${purpose}.${JSON.stringify(value)}`;
  const signature = await hmac(body);
  return `${encodeText(body)}.${signature}`;
}

/**
 * Verify a signed payload and return its parsed JSON, or null.
 *
 * Returns null — never throws — for every form of bad input: missing, wrong
 * shape, undecodable, bad signature, wrong purpose, unparseable JSON. A
 * missing `TWO_FACTOR_SECRET` still throws, because that is a deployment
 * error rather than user input.
 */
async function verifyPayload(
  purpose: string,
  token: string | null | undefined
): Promise<unknown> {
  getSecret(); // fail loudly on misconfiguration, before any parsing
  if (!token || typeof token !== 'string') return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const encodedBody = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!encodedBody || !signature) return null;

  let body: string;
  try {
    body = decodeText(encodedBody);
  } catch {
    return null;
  }

  let expected: string;
  try {
    expected = await hmac(body);
  } catch {
    return null;
  }
  if (!safeEqual(signature, expected)) return null;

  // Purpose check AFTER the signature check: a blob signed for another purpose
  // is authentic but must not be accepted here.
  const prefix = `${purpose}.`;
  if (!body.startsWith(prefix)) return null;

  try {
    return JSON.parse(body.slice(prefix.length));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ marker */

export interface ImpersonationMarker {
  /** Company being viewed. */
  companyId: string;
  companyName: string;
  /** The super admin who started this. */
  adminUserId: string;
  adminEmail: string;
  /** The company owner whose session is actually in use. */
  targetUserId: string;
  targetEmail: string;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms — absolute, not a duration, so a clock-free client can compare. */
  expiresAt: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate the decoded marker shape. Every field is required: a marker missing
 * `targetUserId` would otherwise be honoured by the middleware's binding check
 * against `undefined`.
 */
function asMarker(value: unknown): ImpersonationMarker | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;

  if (!isNonEmptyString(m.companyId)) return null;
  if (!isNonEmptyString(m.adminUserId)) return null;
  if (!isNonEmptyString(m.targetUserId)) return null;
  if (typeof m.startedAt !== 'number' || !Number.isFinite(m.startedAt)) return null;
  if (typeof m.expiresAt !== 'number' || !Number.isFinite(m.expiresAt)) return null;

  return {
    companyId: m.companyId,
    companyName: isNonEmptyString(m.companyName) ? m.companyName : 'this company',
    adminUserId: m.adminUserId,
    adminEmail: isNonEmptyString(m.adminEmail) ? m.adminEmail : '',
    targetUserId: m.targetUserId,
    targetEmail: isNonEmptyString(m.targetEmail) ? m.targetEmail : '',
    startedAt: m.startedAt,
    expiresAt: m.expiresAt,
  };
}

/** Build the signed marker cookie value. */
export async function signImpersonationMarker(
  marker: ImpersonationMarker
): Promise<string> {
  return signPayload(MARKER_PURPOSE, marker);
}

/**
 * Verify the marker cookie and return it, or null.
 *
 * Signature and shape only — this does NOT check expiry or session binding.
 * Callers combine it with `isMarkerActive` / `isMarkerForUser` so that an
 * EXPIRED marker is still readable: the middleware needs to tell "expired,
 * send them back to their own account" apart from "no marker at all".
 */
export async function verifyImpersonationMarker(
  token: string | null | undefined
): Promise<ImpersonationMarker | null> {
  return asMarker(await verifyPayload(MARKER_PURPOSE, token));
}

/**
 * Is this marker within its time window right now?
 *
 * Pure, so the 60-minute rule is testable without cookies or crypto.
 * `startedAt` in the future is rejected as nonsense (a replayed marker from a
 * skewed clock should not buy extra time).
 */
export function isMarkerActive(
  marker: ImpersonationMarker | null,
  nowMs: number = Date.now()
): boolean {
  if (!marker) return false;
  if (marker.expiresAt <= nowMs) return false;
  if (marker.startedAt > nowMs) return false;
  // Defend against a marker claiming a window longer than policy allows.
  if (marker.expiresAt - marker.startedAt > IMPERSONATION_MAX_AGE_SECONDS * 1000) {
    return false;
  }
  return true;
}

/**
 * Is this marker bound to the session presenting it?
 *
 * The check that makes a readable marker safe. A marker is only meaningful for
 * the user it names as the impersonation TARGET; presented by anyone else it
 * is ignored, so it cannot be copied into another browser to skip 2FA.
 */
export function isMarkerForUser(
  marker: ImpersonationMarker | null,
  userId: string | null
): boolean {
  if (!marker || !userId) return false;
  return marker.targetUserId === userId;
}

/** Milliseconds left, floored at zero. For the banner countdown. */
export function markerMsRemaining(
  marker: ImpersonationMarker,
  nowMs: number = Date.now()
): number {
  return Math.max(0, marker.expiresAt - nowMs);
}

/* ------------------------------------------------------------ return ticket */

export interface ImpersonationReturn {
  adminUserId: string;
  adminEmail: string;
  /** The admin's own refresh token, used to put their session back. */
  refreshToken: string;
  /** Epoch ms. Matches the marker's window. */
  expiresAt: number;
}

function asReturn(value: unknown): ImpersonationReturn | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;

  if (!isNonEmptyString(r.adminUserId)) return null;
  if (!isNonEmptyString(r.refreshToken)) return null;
  if (typeof r.expiresAt !== 'number' || !Number.isFinite(r.expiresAt)) return null;

  return {
    adminUserId: r.adminUserId,
    adminEmail: isNonEmptyString(r.adminEmail) ? r.adminEmail : '',
    refreshToken: r.refreshToken,
    expiresAt: r.expiresAt,
  };
}

/** Build the signed, httpOnly return-ticket cookie value. */
export async function signImpersonationReturn(
  ticket: ImpersonationReturn
): Promise<string> {
  return signPayload(RETURN_PURPOSE, ticket);
}

/**
 * Verify the return ticket and return it, or null.
 *
 * Expiry is NOT enforced here, and that is deliberate: the ticket is the only
 * way back to the admin's own account. Refusing to read a ticket a minute past
 * its window would strand the admin signed in as a customer, which is the
 * single worst outcome this feature can produce. The 60-minute limit is
 * enforced on the marker (what grants customer access); the ticket is only
 * ever spent to UNDO that, so a late redemption is strictly safer than none.
 * Supabase independently rejects a refresh token that is genuinely dead.
 */
export async function verifyImpersonationReturn(
  token: string | null | undefined
): Promise<ImpersonationReturn | null> {
  return asReturn(await verifyPayload(RETURN_PURPOSE, token));
}

/* ----------------------------------------------------------- cookie options */

/**
 * Flags for both cookies. `secure` follows NODE_ENV so local http dev works,
 * matching what `/api/auth/2fa/grant` already does for `sam_2fa`.
 */
export function impersonationCookieOptions(httpOnly: boolean, maxAge: number) {
  return {
    httpOnly,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
