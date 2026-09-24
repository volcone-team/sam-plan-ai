/**
 * Two-factor device-trust cookie (admin email-OTP flow).
 *
 * This module is imported by Next.js middleware, which runs on the **Edge
 * runtime**. That means no `node:crypto`, no `Buffer` — everything here uses
 * Web Crypto (`globalThis.crypto.subtle`) and hand-rolled base64url so the same
 * code works in middleware, route handlers, and tests.
 *
 * The cookie this module signs IS the enforcement marker: middleware treats a
 * valid `sam_2fa` cookie as proof that this device already passed the emailed
 * code challenge. There is no server-side session table — trust lives entirely
 * in the HMAC signature plus the embedded issue timestamp, so a forged or
 * stale cookie simply fails verification.
 *
 * Token shape: base64url(`${userId}:${issuedAtMs}`) + "." + base64url(HMAC_SHA256)
 */

export const TWO_FACTOR_COOKIE = 'sam_2fa';
export const TWO_FACTOR_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.TWO_FACTOR_SECRET;
  if (!secret) {
    throw new Error(
      'TWO_FACTOR_SECRET is not set. Add it to your environment before using two-factor device trust.'
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
 * Sign a device-trust token for `userId`, stamped with the current time.
 * Throws only if `TWO_FACTOR_SECRET` is missing.
 */
export async function signDeviceToken(userId: string): Promise<string> {
  const payload = `${userId}:${Date.now()}`;
  const signature = await hmac(payload);
  return `${encodeText(payload)}.${signature}`;
}

/**
 * Verify a device-trust token. Returns true only when the signature is valid,
 * the payload belongs to `expectedUserId`, and the token is within the 30-day
 * window. Malformed input returns false rather than throwing; a missing
 * `TWO_FACTOR_SECRET` still throws (that's a deployment error, not user input).
 */
export async function verifyDeviceToken(
  token: string | null | undefined,
  expectedUserId: string
): Promise<boolean> {
  getSecret(); // fail loudly on misconfiguration, before any parsing
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return false;

  let payload: string;
  try {
    payload = decodeText(encodedPayload);
  } catch {
    return false;
  }

  let expected: string;
  try {
    expected = await hmac(payload);
  } catch {
    return false;
  }
  if (!safeEqual(signature, expected)) return false;

  const separator = payload.lastIndexOf(':');
  if (separator <= 0) return false;
  const userId = payload.slice(0, separator);
  const issuedAt = Number(payload.slice(separator + 1));

  if (!userId || userId !== expectedUserId) return false;
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;

  const age = Date.now() - issuedAt;
  if (age < 0) return false;
  return age <= TWO_FACTOR_MAX_AGE_SECONDS * 1000;
}
