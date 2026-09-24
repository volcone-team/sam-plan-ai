/**
 * Unsubscribe token generation + verification.
 *
 * Emails carry a signed, opaque token instead of a raw user id, so an
 * unsubscribe link cannot be forged and user ids cannot be enumerated
 * (Req 5.1). A token is an HMAC-SHA256 over `${userId}:${category}` keyed by
 * NOTIFICATIONS_TOKEN_SECRET, encoded base64url:
 *
 *   token = base64url(payload) + "." + base64url(hmac(payload))
 *
 * Verification recomputes the HMAC and compares in constant time. A tampered
 * payload yields a different signature and is rejected.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_CATEGORY = "initiative_reminder";

function secret(): string {
  const s = process.env.NOTIFICATIONS_TOKEN_SECRET;
  if (!s) {
    throw new Error("NOTIFICATIONS_TOKEN_SECRET is not set");
  }
  return s;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface UnsubscribePayload {
  userId: string;
  category: string;
}

/** Build an opaque unsubscribe token for a user + category. */
export function generateUnsubscribeToken(userId: string, category: string = DEFAULT_CATEGORY): string {
  const payload = `${userId}:${category}`;
  return `${base64url(payload)}.${sign(payload)}`;
}

/**
 * Verify a token and return its payload, or null if invalid/tampered.
 * Never throws on malformed input (except when the secret is unset).
 */
export function verifyUnsubscribeToken(token: string | null | undefined): UnsubscribePayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const encodedPayload = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSig = sign(payload);

  // Constant-time comparison; bail if lengths differ (timingSafeEqual throws on
  // unequal-length buffers).
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const sep = payload.indexOf(":");
  if (sep <= 0) return null;
  return { userId: payload.slice(0, sep), category: payload.slice(sep + 1) };
}
